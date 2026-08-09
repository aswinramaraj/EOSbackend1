import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { SetPinDto } from './dto/set-pin.dto';
import { ChangePinDto } from './dto/change-pin.dto';
import { CreateTopupOrderDto } from './dto/create-topup-order.dto';
import { VerifyTopupDto } from './dto/verify-topup.dto';
import { TransferFundsDto } from './dto/transfer-funds.dto';

const BCRYPT_ROUNDS = 10;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCK_MINUTES = 15;

const TRANSACTION_SELECT = {
  id: true,
  txn_type: true,
  source: true,
  amount: true,
  status: true,
  remarks: true,
  created_at: true,
  wallet_outlets: { select: { name: true, outlet_type: true } },
  // Prisma's auto-generated name for this relation - shifts whenever
  // schema.prisma is re-pulled and the surrounding disambiguation context
  // changes (see the merge that introduced this exact name). No stable
  // alias exists to depend on instead without hand-editing the generated
  // schema, which a plain `db pull` would immediately overwrite again.
  wallets_wallet_transactions_counterparty_wallet_idTowallets: {
    select: { users: { select: { email: true } } },
  },
} as const;

type WalletRow = {
  id: number;
  user_id: number;
  balance: unknown;
  qr_token: string;
  pin_hash: string | null;
  pin_set_at: Date | null;
  failed_pin_attempts: number;
  pin_locked_until: Date | null;
};

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private razorpay: Razorpay | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private getRazorpay(): Razorpay {
    if (!this.razorpay) {
      const key_id = process.env.RAZORPAY_KEY_ID;
      const key_secret = process.env.RAZORPAY_KEY_SECRET;
      if (!key_id || !key_secret) {
        throw new InternalServerErrorException({
          message: 'Razorpay is not configured',
          errorCode: 'RAZORPAY_NOT_CONFIGURED',
        });
      }
      this.razorpay = new Razorpay({ key_id, key_secret });
    }
    return this.razorpay;
  }

  /**
   * Every /me/wallet/* route is already gated to every role except Parent
   * by @Roles() on the controller - this just auto-provisions a
   * zero-balance wallet the first time an eligible user ever touches it,
   * rather than requiring a separate admin-driven creation step.
   */
  private async findOrCreateWallet(userId: number): Promise<WalletRow> {
    const existing = await this.prisma.wallets.findUnique({
      where: { user_id: userId },
    });
    if (existing) return existing;

    try {
      return await this.prisma.wallets.create({ data: { user_id: userId } });
    } catch (err: any) {
      // Race: two concurrent first-opens for the same user - the unique
      // constraint on user_id will reject the loser, just re-fetch instead
      // of surfacing a 500 for something that isn't really an error.
      if (err?.code === 'P2002') {
        const wallet = await this.prisma.wallets.findUnique({
          where: { user_id: userId },
        });
        if (wallet) return wallet;
      }
      this.logger.error('DB error while creating wallet', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /me/wallet — balance, QR token (render as a QR code client-side), and whether a PIN has been set yet. */
  async getWallet(userId: number) {
    const wallet = await this.findOrCreateWallet(userId);
    return {
      balance: Number(wallet.balance),
      qr_token: wallet.qr_token,
      pin_set: wallet.pin_hash !== null,
    };
  }

  /** GET /me/wallet/transactions — the caller's own transaction history, paginated. */
  async getTransactions(userId: number, query: PaginationDto) {
    const wallet = await this.findOrCreateWallet(userId);
    const where = { wallet_id: wallet.id };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.wallet_transactions.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: TRANSACTION_SELECT,
      }),
      this.prisma.wallet_transactions.count({ where }),
    ]);

    return paginate(
      rows.map((r) => ({
        id: r.id,
        txn_type: r.txn_type,
        source: r.source,
        amount: Number(r.amount),
        status: r.status,
        remarks: r.remarks,
        created_at: r.created_at,
        outlet: r.wallet_outlets,
        counterparty_email:
          r.wallets_wallet_transactions_counterparty_wallet_idTowallets?.users.email ?? null,
      })),
      total,
      query,
    );
  }

  /**
   * POST /me/wallet/pin — first-time setup only. Rejects if a PIN already
   * exists (use changePin instead) so a stolen session can't silently
   * overwrite a real PIN without knowing the old one.
   */
  async setPin(userId: number, dto: SetPinDto) {
    const wallet = await this.findOrCreateWallet(userId);
    if (wallet.pin_hash !== null) {
      throw new BadRequestException({
        message: 'A PIN is already set. Use change PIN instead.',
        errorCode: 'PIN_ALREADY_SET',
      });
    }

    const pin_hash = await bcrypt.hash(dto.pin, BCRYPT_ROUNDS);
    await this.prisma.wallets.update({
      where: { id: wallet.id },
      data: { pin_hash, pin_set_at: new Date(), failed_pin_attempts: 0, pin_locked_until: null },
    });

    return { pin_set: true };
  }

  /** PATCH /me/wallet/pin — change an existing PIN; requires the current one. */
  async changePin(userId: number, dto: ChangePinDto) {
    const wallet = await this.findOrCreateWallet(userId);
    await this.assertPinOk(wallet, dto.current_pin);

    const pin_hash = await bcrypt.hash(dto.new_pin, BCRYPT_ROUNDS);
    await this.prisma.wallets.update({
      where: { id: wallet.id },
      data: { pin_hash, pin_set_at: new Date() },
    });

    return { pin_set: true };
  }

  /**
   * GET /me/wallet/resolve/:qrToken — who the sender is about to pay,
   * shown as a confirmation screen before the PIN prompt. 404s rather than
   * leaking anything about a token that doesn't belong to any wallet.
   */
  async resolveByQrToken(userId: number, qrToken: string) {
    const wallet = await this.findOrCreateWallet(userId);

    const receiver = await this.prisma.wallets.findUnique({
      where: { qr_token: qrToken },
      select: { id: true, users: { select: { email: true } } },
    });
    if (!receiver) {
      throw new NotFoundException({
        message: 'This QR code is not linked to any wallet',
        errorCode: 'RECIPIENT_NOT_FOUND',
      });
    }
    if (receiver.id === wallet.id) {
      throw new BadRequestException({
        message: 'You cannot send money to yourself',
        errorCode: 'CANNOT_PAY_SELF',
      });
    }

    return { email: receiver.users.email };
  }

  /**
   * POST /me/wallet/transfer (the "scan QR, enter amount, enter PIN" flow).
   * Debits the sender and credits the receiver as two linked
   * wallet_transactions rows within one DB transaction.
   *
   * The actual balance mutation is NOT done by this code - a pre-existing
   * DB trigger (trg_apply_wallet_transaction / apply_wallet_transaction())
   * applies every wallet_transactions row's amount to its wallet the
   * moment the row's status becomes 'success' (this is how the
   * outlet/cash/razorpay paths already worked before this feature existed
   * - staying consistent with that rather than having two different ways
   * a balance can change). What this method IS responsible for is the
   * insufficient-balance guard the trigger has no concept of, done via an
   * explicit `SELECT ... FOR UPDATE` locking both wallet rows (always in
   * ascending id order, so two opposite-direction concurrent transfers
   * between the same pair of wallets can never deadlock) before the
   * inserts - the lock is held for the rest of the DB transaction, so a
   * concurrent transfer out of the same sender wallet has to wait its turn
   * rather than both racing past the balance check.
   */
  async transfer(userId: number, dto: TransferFundsDto) {
    const sender = await this.findOrCreateWallet(userId);
    await this.assertPinOk(sender, dto.pin);

    const receiver = await this.prisma.wallets.findUnique({
      where: { qr_token: dto.qr_token },
    });
    if (!receiver) {
      throw new NotFoundException({
        message: 'This QR code is not linked to any wallet',
        errorCode: 'RECIPIENT_NOT_FOUND',
      });
    }
    if (receiver.id === sender.id) {
      throw new BadRequestException({
        message: 'You cannot send money to yourself',
        errorCode: 'CANNOT_PAY_SELF',
      });
    }

    const debitTxnId = await this.prisma.$transaction(async (tx) => {
      const [firstId, secondId] = [sender.id, receiver.id].sort((a, b) => a - b);
      const locked = await tx.$queryRaw<Array<{ id: number; balance: Prisma.Decimal }>>(
        Prisma.sql`SELECT id, balance FROM wallets WHERE id IN (${firstId}, ${secondId}) ORDER BY id FOR UPDATE`,
      );
      const senderRow = locked.find((w) => w.id === sender.id);
      if (!senderRow || senderRow.balance.lessThan(dto.amount)) {
        throw new BadRequestException({
          message: 'Insufficient balance',
          errorCode: 'INSUFFICIENT_BALANCE',
        });
      }

      const debitTxn = await tx.wallet_transactions.create({
        data: {
          wallet_id: sender.id,
          txn_type: 'debit',
          source: 'transfer',
          amount: dto.amount,
          status: 'success',
          counterparty_wallet_id: receiver.id,
        },
      });
      const creditTxn = await tx.wallet_transactions.create({
        data: {
          wallet_id: receiver.id,
          txn_type: 'credit',
          source: 'transfer',
          amount: dto.amount,
          status: 'success',
          counterparty_wallet_id: sender.id,
          related_transaction_id: debitTxn.id,
        },
      });
      await tx.wallet_transactions.update({
        where: { id: debitTxn.id },
        data: { related_transaction_id: creditTxn.id },
      });

      return debitTxn.id;
    });

    const updatedSender = await this.prisma.wallets.findUniqueOrThrow({
      where: { id: sender.id },
    });

    this.logger.log(
      `Wallet transfer: ${dto.amount} from wallet=${sender.id} to wallet=${receiver.id} (txn=${debitTxnId})`,
    );
    return { balance: Number(updatedSender.balance), transaction_id: debitTxnId };
  }

  /**
   * POST /me/wallet/topup/order — creates a Razorpay order and a matching
   * `pending` wallet_transactions row (source=razorpay). Returns what the
   * mobile Razorpay Checkout SDK needs to open its payment sheet; the
   * wallet is only ever credited later, by verifyTopup(), once the
   * signature is independently confirmed.
   */
  async createTopupOrder(userId: number, dto: CreateTopupOrderDto) {
    const wallet = await this.findOrCreateWallet(userId);
    const razorpay = this.getRazorpay();

    const order = await razorpay.orders.create({
      amount: Math.round(dto.amount * 100), // rupees -> paise
      currency: 'INR',
      receipt: `wallet-${wallet.id}-${Date.now()}`,
    });

    await this.prisma.wallet_transactions.create({
      data: {
        wallet_id: wallet.id,
        txn_type: 'credit',
        source: 'razorpay',
        amount: dto.amount,
        status: 'pending',
        razorpay_order_id: order.id,
      },
    });

    return {
      order_id: order.id,
      amount: dto.amount,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
    };
  }

  /**
   * POST /me/wallet/topup/verify — recomputes the HMAC-SHA256 signature
   * server-side (order_id|payment_id, signed with the key secret) rather
   * than trusting the client's claim that Checkout succeeded. Only credits
   * the wallet on a genuine signature match.
   */
  async verifyTopup(userId: number, dto: VerifyTopupDto) {
    const wallet = await this.findOrCreateWallet(userId);

    const txn = await this.prisma.wallet_transactions.findUnique({
      where: { razorpay_order_id: dto.razorpay_order_id },
    });
    if (!txn || txn.wallet_id !== wallet.id) {
      throw new NotFoundException({
        message: 'No matching top-up order found for your wallet',
        errorCode: 'TOPUP_ORDER_NOT_FOUND',
      });
    }
    if (txn.status !== 'pending') {
      throw new BadRequestException({
        message: 'This top-up order has already been processed',
        errorCode: 'INVALID_WORKFLOW_STATE',
      });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      throw new InternalServerErrorException({
        message: 'Razorpay is not configured',
        errorCode: 'RAZORPAY_NOT_CONFIGURED',
      });
    }
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${dto.razorpay_order_id}|${dto.razorpay_payment_id}`)
      .digest('hex');

    if (expectedSignature !== dto.razorpay_signature) {
      await this.prisma.wallet_transactions.update({
        where: { id: txn.id },
        data: {
          status: 'failed',
          razorpay_payment_id: dto.razorpay_payment_id,
          razorpay_signature: dto.razorpay_signature,
        },
      });
      throw new BadRequestException({
        message: "Payment verification failed - signature doesn't match",
        errorCode: 'PAYMENT_VERIFICATION_FAILED',
      });
    }

    // Flipping status to 'success' is what actually credits the wallet -
    // see the transfer() doc comment above for why this doesn't also do
    // its own balance update: the pre-existing DB trigger
    // (apply_wallet_transaction()) applies it as soon as this commits.
    await this.prisma.wallet_transactions.update({
      where: { id: txn.id },
      data: {
        status: 'success',
        razorpay_payment_id: dto.razorpay_payment_id,
        razorpay_signature: dto.razorpay_signature,
      },
    });

    const updatedWallet = await this.prisma.wallets.findUniqueOrThrow({
      where: { id: wallet.id },
    });

    this.logger.log(`Wallet top-up verified: wallet=${wallet.id} amount=${txn.amount}`);
    return { balance: Number(updatedWallet.balance) };
  }

  /**
   * Shared PIN check for changePin/transfer - lockout-aware, resets the
   * failed-attempt counter on success, escalates to a timed lock after
   * MAX_PIN_ATTEMPTS wrong guesses in a row.
   */
  private async assertPinOk(wallet: WalletRow, pin: string) {
    if (wallet.pin_hash === null) {
      throw new BadRequestException({
        message: 'Set your wallet PIN first',
        errorCode: 'PIN_NOT_SET',
      });
    }
    if (wallet.pin_locked_until && wallet.pin_locked_until.getTime() > Date.now()) {
      throw new ForbiddenException({
        message: 'Too many incorrect PIN attempts. Please try again later.',
        errorCode: 'PIN_LOCKED',
      });
    }

    const matches = await bcrypt.compare(pin, wallet.pin_hash);
    if (!matches) {
      const attempts = wallet.failed_pin_attempts + 1;
      const lockedOut = attempts >= MAX_PIN_ATTEMPTS;
      await this.prisma.wallets.update({
        where: { id: wallet.id },
        data: {
          failed_pin_attempts: lockedOut ? 0 : attempts,
          pin_locked_until: lockedOut
            ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000)
            : null,
        },
      });
      if (lockedOut) {
        throw new ForbiddenException({
          message: `Too many incorrect PIN attempts. Try again in ${PIN_LOCK_MINUTES} minutes.`,
          errorCode: 'PIN_LOCKED',
        });
      }
      throw new UnauthorizedException({
        message: 'Incorrect PIN',
        errorCode: 'WRONG_PIN',
      });
    }

    if (wallet.failed_pin_attempts > 0 || wallet.pin_locked_until) {
      await this.prisma.wallets.update({
        where: { id: wallet.id },
        data: { failed_pin_attempts: 0, pin_locked_until: null },
      });
    }
  }
}
