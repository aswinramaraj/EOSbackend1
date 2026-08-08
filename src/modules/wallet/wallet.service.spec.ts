jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
  // Real Prisma.sql builds a tagged-template Sql object for $queryRaw; the
  // mocked $queryRaw below never actually parses it, it just needs
  // something to pass through, so a simple pass-through stand-in is enough.
  Prisma: { sql: (strings: unknown, ...values: unknown[]) => ({ strings, values }) },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

const mockOrdersCreate = jest.fn();
jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({
    orders: { create: mockOrdersCreate },
  })),
);

import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { WalletService } from './wallet.service';

describe('WalletService', () => {
  let service: WalletService;
  let prisma: {
    wallets: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    wallet_transactions: {
      findMany: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
    };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };

  function walletRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      user_id: 10,
      balance: '500.00',
      qr_token: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      pin_hash: null,
      pin_set_at: null,
      failed_pin_attempts: 0,
      pin_locked_until: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'test_secret';
    mockOrdersCreate.mockReset();

    prisma = {
      wallets: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      wallet_transactions: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
    };
    // Both array-form ($transaction([...])) and interactive callback-form
    // ($transaction(async (tx) => ...)) are used across this service -
    // support both, passing the same mock object as `tx`.
    prisma.$transaction.mockImplementation((arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (tx: unknown) => Promise<unknown>)(prisma);
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [WalletService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<WalletService>(WalletService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getWallet', () => {
    it('auto-creates a zero-balance wallet on first touch', async () => {
      prisma.wallets.findUnique.mockResolvedValue(null);
      prisma.wallets.create.mockResolvedValue(walletRow({ balance: '0' }));

      const result = await service.getWallet(10);

      expect(prisma.wallets.create).toHaveBeenCalledWith({ data: { user_id: 10 } });
      expect(result).toEqual({ balance: 0, qr_token: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', pin_set: false });
    });

    it('returns the existing wallet without creating a new one', async () => {
      prisma.wallets.findUnique.mockResolvedValue(walletRow({ pin_hash: 'hashed' }));

      const result = await service.getWallet(10);

      expect(prisma.wallets.create).not.toHaveBeenCalled();
      expect(result).toEqual({ balance: 500, qr_token: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', pin_set: true });
    });
  });

  describe('setPin', () => {
    it('throws 400 when a PIN is already set', async () => {
      prisma.wallets.findUnique.mockResolvedValue(walletRow({ pin_hash: 'already-set' }));

      await expect(service.setPin(10, { pin: '1234' })).rejects.toMatchObject({
        response: { errorCode: 'PIN_ALREADY_SET' },
      });
      expect(prisma.wallets.update).not.toHaveBeenCalled();
    });

    it('hashes and stores the PIN on first setup', async () => {
      prisma.wallets.findUnique.mockResolvedValue(walletRow());
      prisma.wallets.update.mockResolvedValue(walletRow({ pin_hash: 'x' }));

      const result = await service.setPin(10, { pin: '1234' });

      const [args] = prisma.wallets.update.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(args.data.pin_hash).not.toBe('1234');
      expect(await bcrypt.compare('1234', args.data.pin_hash as string)).toBe(true);
      expect(result).toEqual({ pin_set: true });
    });
  });

  describe('changePin (via assertPinOk)', () => {
    it('throws 400 when no PIN has ever been set', async () => {
      prisma.wallets.findUnique.mockResolvedValue(walletRow());

      await expect(
        service.changePin(10, { current_pin: '1234', new_pin: '5678' }),
      ).rejects.toMatchObject({ response: { errorCode: 'PIN_NOT_SET' } });
    });

    it('throws 403 immediately while locked out, without re-checking the PIN', async () => {
      const futureLock = new Date(Date.now() + 60_000);
      prisma.wallets.findUnique.mockResolvedValue(
        walletRow({ pin_hash: await bcrypt.hash('1234', 4), pin_locked_until: futureLock }),
      );

      await expect(
        service.changePin(10, { current_pin: '1234', new_pin: '5678' }),
      ).rejects.toMatchObject({ response: { errorCode: 'PIN_LOCKED' } });
      expect(prisma.wallets.update).not.toHaveBeenCalled();
    });

    it('throws 401 on a wrong current PIN and increments the failed-attempt counter', async () => {
      prisma.wallets.findUnique.mockResolvedValue(
        walletRow({ pin_hash: await bcrypt.hash('1234', 4), failed_pin_attempts: 1 }),
      );

      await expect(
        service.changePin(10, { current_pin: '0000', new_pin: '5678' }),
      ).rejects.toMatchObject({ response: { errorCode: 'WRONG_PIN' } });
      expect(prisma.wallets.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { failed_pin_attempts: 2, pin_locked_until: null },
      });
    });

    it('locks the wallet after the 5th consecutive wrong PIN attempt', async () => {
      prisma.wallets.findUnique.mockResolvedValue(
        walletRow({ pin_hash: await bcrypt.hash('1234', 4), failed_pin_attempts: 4 }),
      );

      await expect(
        service.changePin(10, { current_pin: '0000', new_pin: '5678' }),
      ).rejects.toMatchObject({ response: { errorCode: 'PIN_LOCKED' } });
      const [args] = prisma.wallets.update.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(args.data.failed_pin_attempts).toBe(0);
      expect(args.data.pin_locked_until).toBeInstanceOf(Date);
    });

    it('updates to the new PIN and resets the failed-attempt counter on a correct current PIN', async () => {
      prisma.wallets.findUnique.mockResolvedValue(
        walletRow({ pin_hash: await bcrypt.hash('1234', 4), failed_pin_attempts: 2 }),
      );
      prisma.wallets.update.mockResolvedValue(walletRow({ pin_hash: 'new' }));

      const result = await service.changePin(10, { current_pin: '1234', new_pin: '5678' });

      // First update call resets the lockout counter (inside assertPinOk),
      // second sets the new PIN hash.
      expect(prisma.wallets.update).toHaveBeenCalledTimes(2);
      expect(prisma.wallets.update.mock.calls[0][0]).toMatchObject({
        data: { failed_pin_attempts: 0, pin_locked_until: null },
      });
      expect(result).toEqual({ pin_set: true });
    });
  });

  describe('resolveByQrToken', () => {
    it('throws 404 for a token that matches no wallet', async () => {
      prisma.wallets.findUnique
        .mockResolvedValueOnce(walletRow()) // sender's own wallet
        .mockResolvedValueOnce(null); // receiver lookup

      await expect(service.resolveByQrToken(10, 'unknown-token')).rejects.toMatchObject({
        response: { errorCode: 'RECIPIENT_NOT_FOUND' },
      });
    });

    it('throws 400 when the token resolves to the caller\'s own wallet', async () => {
      prisma.wallets.findUnique
        .mockResolvedValueOnce(walletRow({ id: 1 }))
        .mockResolvedValueOnce({ id: 1, users: { email: 'me@sece.ac.in' } });

      await expect(service.resolveByQrToken(10, 'own-token')).rejects.toMatchObject({
        response: { errorCode: 'CANNOT_PAY_SELF' },
      });
    });

    it("returns the receiver's email on a valid, different wallet", async () => {
      prisma.wallets.findUnique
        .mockResolvedValueOnce(walletRow({ id: 1 }))
        .mockResolvedValueOnce({ id: 2, users: { email: 'friend@sece.ac.in' } });

      const result = await service.resolveByQrToken(10, 'their-token');
      expect(result).toEqual({ email: 'friend@sece.ac.in' });
    });
  });

  describe('transfer', () => {
    const pin = '1234';

    // Duck-typed stand-in for Prisma.Decimal - transfer() only ever calls
    // .lessThan() on a locked row's balance, so that's all this needs.
    function fakeDecimal(value: number) {
      return { lessThan: (v: number) => value < v };
    }

    it('throws 400 INSUFFICIENT_BALANCE when the locked sender balance is below the requested amount', async () => {
      prisma.wallets.findUnique
        .mockResolvedValueOnce(walletRow({ id: 1, pin_hash: await bcrypt.hash(pin, 4) })) // sender
        .mockResolvedValueOnce(walletRow({ id: 2, user_id: 20 })); // receiver
      prisma.$queryRaw.mockResolvedValue([
        { id: 1, balance: fakeDecimal(10) },
        { id: 2, balance: fakeDecimal(0) },
      ]);

      await expect(
        service.transfer(10, { qr_token: 'their-token', amount: 5000, pin }),
      ).rejects.toMatchObject({ response: { errorCode: 'INSUFFICIENT_BALANCE' } });
      expect(prisma.wallet_transactions.create).not.toHaveBeenCalled();
    });

    it('throws 400 CANNOT_PAY_SELF before ever locking any balance', async () => {
      prisma.wallets.findUnique
        .mockResolvedValueOnce(walletRow({ id: 1, pin_hash: await bcrypt.hash(pin, 4) }))
        .mockResolvedValueOnce(walletRow({ id: 1 })); // same wallet id as sender

      await expect(
        service.transfer(10, { qr_token: 'own-token', amount: 100, pin }),
      ).rejects.toMatchObject({ response: { errorCode: 'CANNOT_PAY_SELF' } });
      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('locks both wallets in ascending-id order, creates the paired transactions, and lets the DB trigger apply the balance - on success', async () => {
      prisma.wallets.findUnique
        .mockResolvedValueOnce(walletRow({ id: 1, pin_hash: await bcrypt.hash(pin, 4) })) // sender
        .mockResolvedValueOnce(walletRow({ id: 2, user_id: 20 })); // receiver
      prisma.$queryRaw.mockResolvedValue([
        { id: 1, balance: fakeDecimal(500) },
        { id: 2, balance: fakeDecimal(200) },
      ]);
      prisma.wallets.findUniqueOrThrow.mockResolvedValue(walletRow({ id: 1, balance: '400.00' }));
      prisma.wallet_transactions.create
        .mockResolvedValueOnce({ id: 501 }) // debit row
        .mockResolvedValueOnce({ id: 502 }); // credit row

      const result = await service.transfer(10, { qr_token: 'their-token', amount: 100, pin });

      // No manual balance mutation here at all - see the doc comment on
      // transfer() for why (a pre-existing DB trigger applies it).
      expect(prisma.wallets.update).not.toHaveBeenCalled();
      expect(prisma.wallets.updateMany).not.toHaveBeenCalled();
      expect(prisma.wallet_transactions.create).toHaveBeenNthCalledWith(1, {
        data: {
          wallet_id: 1,
          txn_type: 'debit',
          source: 'transfer',
          amount: 100,
          status: 'success',
          counterparty_wallet_id: 2,
        },
      });
      expect(prisma.wallet_transactions.create).toHaveBeenNthCalledWith(2, {
        data: {
          wallet_id: 2,
          txn_type: 'credit',
          source: 'transfer',
          amount: 100,
          status: 'success',
          counterparty_wallet_id: 1,
          related_transaction_id: 501,
        },
      });
      expect(prisma.wallet_transactions.update).toHaveBeenCalledWith({
        where: { id: 501 },
        data: { related_transaction_id: 502 },
      });
      expect(result).toEqual({ balance: 400, transaction_id: 501 });
    });
  });

  describe('createTopupOrder', () => {
    it('creates a Razorpay order in paise and a pending wallet_transactions row', async () => {
      prisma.wallets.findUnique.mockResolvedValue(walletRow());
      mockOrdersCreate.mockResolvedValue({ id: 'order_abc123' });

      const result = await service.createTopupOrder(10, { amount: 250 });

      expect(mockOrdersCreate).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 25000, currency: 'INR' }),
      );
      expect(prisma.wallet_transactions.create).toHaveBeenCalledWith({
        data: {
          wallet_id: 1,
          txn_type: 'credit',
          source: 'razorpay',
          amount: 250,
          status: 'pending',
          razorpay_order_id: 'order_abc123',
        },
      });
      expect(result).toEqual({
        order_id: 'order_abc123',
        amount: 250,
        currency: 'INR',
        key_id: 'rzp_test_key',
      });
    });
  });

  describe('verifyTopup', () => {
    function signaturePayload(orderId: string, paymentId: string) {
      return crypto
        .createHmac('sha256', 'test_secret')
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
    }

    it('throws 404 when no pending order matches for this wallet', async () => {
      prisma.wallets.findUnique.mockResolvedValue(walletRow());
      prisma.wallet_transactions.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyTopup(10, {
          razorpay_order_id: 'order_x',
          razorpay_payment_id: 'pay_x',
          razorpay_signature: 'sig',
        }),
      ).rejects.toMatchObject({ response: { errorCode: 'TOPUP_ORDER_NOT_FOUND' } });
    });

    it('marks the transaction failed and throws 400 on a signature mismatch', async () => {
      prisma.wallets.findUnique.mockResolvedValue(walletRow({ id: 1 }));
      prisma.wallet_transactions.findUnique.mockResolvedValue({
        id: 900,
        wallet_id: 1,
        status: 'pending',
        amount: '250.00',
      });

      await expect(
        service.verifyTopup(10, {
          razorpay_order_id: 'order_abc123',
          razorpay_payment_id: 'pay_abc123',
          razorpay_signature: 'not-the-real-signature',
        }),
      ).rejects.toMatchObject({ response: { errorCode: 'PAYMENT_VERIFICATION_FAILED' } });
      expect(prisma.wallet_transactions.update).toHaveBeenCalledWith({
        where: { id: 900 },
        data: {
          status: 'failed',
          razorpay_payment_id: 'pay_abc123',
          razorpay_signature: 'not-the-real-signature',
        },
      });
    });

    it('marks the transaction successful and re-reads the balance the DB trigger applied, on a valid signature', async () => {
      prisma.wallets.findUnique.mockResolvedValue(walletRow({ id: 1 }));
      prisma.wallet_transactions.findUnique.mockResolvedValue({
        id: 900,
        wallet_id: 1,
        status: 'pending',
        amount: '250.00',
      });
      prisma.wallets.findUniqueOrThrow.mockResolvedValue(walletRow({ id: 1, balance: '750.00' }));

      const validSignature = signaturePayload('order_abc123', 'pay_abc123');
      const result = await service.verifyTopup(10, {
        razorpay_order_id: 'order_abc123',
        razorpay_payment_id: 'pay_abc123',
        razorpay_signature: validSignature,
      });

      expect(prisma.wallet_transactions.update).toHaveBeenCalledWith({
        where: { id: 900 },
        data: {
          status: 'success',
          razorpay_payment_id: 'pay_abc123',
          razorpay_signature: validSignature,
        },
      });
      // No manual balance mutation here - see the doc comment on
      // transfer() for why (a pre-existing DB trigger applies it); this
      // just re-reads the wallet after the trigger has already run.
      expect(prisma.wallets.update).not.toHaveBeenCalled();
      expect(result).toEqual({ balance: 750 });
    });

    it('throws 400 when the order has already been processed', async () => {
      prisma.wallets.findUnique.mockResolvedValue(walletRow({ id: 1 }));
      prisma.wallet_transactions.findUnique.mockResolvedValue({
        id: 900,
        wallet_id: 1,
        status: 'success',
        amount: '250.00',
      });

      await expect(
        service.verifyTopup(10, {
          razorpay_order_id: 'order_abc123',
          razorpay_payment_id: 'pay_abc123',
          razorpay_signature: 'whatever',
        }),
      ).rejects.toMatchObject({ response: { errorCode: 'INVALID_WORKFLOW_STATE' } });
    });
  });
});
