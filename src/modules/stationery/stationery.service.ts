import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { Prisma } from '../../../generated/prisma/client';
import type {
  stationery_category_enum,
  stationery_order_status_enum,
} from '../../../generated/prisma/enums';
import { PrismaService } from 'src/prisma/prisma.service';
import { WalletService } from 'src/modules/wallet/wallet.service';
import { StorageService } from 'src/common/storage/storage.service';
import { STORAGE_BUCKETS } from 'src/common/constants/storage-buckets.constant';
import { CheckoutItemDto } from './dto/checkout-item.dto';
import { CheckoutWalletDto } from './dto/checkout-wallet.dto';
import { CheckoutRazorpayOrderDto } from './dto/checkout-razorpay-order.dto';
import { VerifyRazorpayOrderDto } from './dto/verify-razorpay-order.dto';
import { CreateStationeryProductDto } from './dto/create-stationery-product.dto';
import { UpdateStationeryProductDto } from './dto/update-stationery-product.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';

const PRODUCT_SELECT = {
  id: true,
  category: true,
  name: true,
  description: true,
  specs: true,
  price: true,
  original_price: true,
  stock_quantity: true,
  image_url: true,
  is_active: true,
} as const;

/**
 * Campus "Stationery Store" - a shopping-cart e-commerce module distinct
 * from the pre-existing Xerox/print-shop `stationary_requests` flow (see
 * prisma/migrations/stationery_store.sql's own top comment). Open to every
 * role ("for all login" per the feature request) - there is no student/
 * faculty-only restriction anywhere in this service; the controllers gate
 * only the counter-staff/admin management endpoints.
 */
@Injectable()
export class StationeryService {
  private readonly logger = new Logger(StationeryService.name);
  private razorpay: Razorpay | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    private readonly storage: StorageService,
  ) {}

  private readonly PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  private readonly PHOTO_MAX_BYTES = 5 * 1024 * 1024; // 5MB, same limit as venues/student photos

  /**
   * POST /stationery/admin/products/image-upload - a standalone upload, not
   * tied to a product id, since the Add-product form needs to show/attach an
   * image before the product itself is created. Returns a public image_url
   * the caller then passes straight through create/update's own image_url
   * field - same "upload first, reference the URL in the real write next"
   * shape as every other optional-photo flow in this backend.
   */
  async uploadProductImage(file: Express.Multer.File) {
    if (!this.PHOTO_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        message: `That file type is not accepted. JPG, PNG or WebP only - got ${file.mimetype || 'an unknown type'}.`,
        errorCode: 'INVALID_PHOTO_TYPE',
      });
    }
    if (file.size > this.PHOTO_MAX_BYTES) {
      throw new BadRequestException({
        message: `File is too large - the limit is ${this.PHOTO_MAX_BYTES / (1024 * 1024)}MB.`,
        errorCode: 'PHOTO_TOO_LARGE',
      });
    }
    const { key } = await this.storage.upload(
      'stationery-products',
      file.originalname,
      file.buffer,
      file.mimetype,
      STORAGE_BUCKETS.STATIONERY_PRODUCT_IMAGES,
    );
    return { image_url: this.storage.getPublicUrl(key, STORAGE_BUCKETS.STATIONERY_PRODUCT_IMAGES) };
  }

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
   * The Stationery Store's own wallet_outlets row - already seeded in this
   * database (id 11, "Campus Stationery Store", outlet_type='stationary'),
   * ahead of this feature being built. Looked up by outlet_type rather than
   * hard-coded id, so this keeps working if that row's id ever differs
   * between environments.
   */
  private async getOutletId(): Promise<number> {
    const outlet = await this.prisma.wallet_outlets.findFirst({
      where: { outlet_type: 'stationary' },
      select: { id: true },
    });
    if (!outlet) {
      throw new InternalServerErrorException({
        message: 'Stationery Store wallet outlet is not configured',
        errorCode: 'STATIONERY_OUTLET_NOT_CONFIGURED',
      });
    }
    return outlet.id;
  }

  // ── Catalogue (any authenticated role) ──────────────────────────────────

  /** GET /stationery/products?category=&search= */
  async listProducts(category?: string, search?: string) {
    const products = await this.prisma.stationery_products.findMany({
      where: {
        is_active: true,
        ...(category ? { category: category as stationery_category_enum } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      select: PRODUCT_SELECT,
      orderBy: { name: 'asc' },
    });
    return products;
  }

  /** GET /stationery/products/:id */
  async getProduct(id: number) {
    const product = await this.prisma.stationery_products.findFirst({
      where: { id, is_active: true },
      select: PRODUCT_SELECT,
    });
    if (!product) {
      throw new NotFoundException({
        message: 'Product not found',
        errorCode: 'PRODUCT_NOT_FOUND',
      });
    }
    return product;
  }

  /**
   * Shared by both checkout paths - re-fetches every product from the DB
   * (never trusts a client-supplied name/price) and checks stock. Does NOT
   * decrement stock or write anything - that only happens once payment is
   * actually confirmed (see decrementStockAndBuildItems below), so an
   * abandoned cart or a failed payment never touches inventory.
   */
  private async priceCart(items: CheckoutItemDto[]) {
    if (items.length === 0) {
      throw new BadRequestException({
        message: 'Cart is empty',
        errorCode: 'EMPTY_CART',
      });
    }
    const productIds = items.map((i) => i.product_id);
    const products = await this.prisma.stationery_products.findMany({
      where: { id: { in: productIds } },
      select: PRODUCT_SELECT,
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    let subtotal = new Prisma.Decimal(0);
    const priced = items.map((item) => {
      const product = byId.get(item.product_id);
      if (!product || !product.is_active) {
        throw new NotFoundException({
          message: `Product ${item.product_id} is not available`,
          errorCode: 'PRODUCT_NOT_FOUND',
        });
      }
      if (product.stock_quantity < item.quantity) {
        throw new UnprocessableEntityException({
          message: `Only ${product.stock_quantity} left of "${product.name}"`,
          errorCode: 'INSUFFICIENT_STOCK',
        });
      }
      const lineSubtotal = product.price.mul(item.quantity);
      subtotal = subtotal.add(lineSubtotal);
      return {
        product_id: product.id,
        product_name: product.name,
        unit_price: product.price,
        quantity: item.quantity,
        subtotal: lineSubtotal,
      };
    });

    const gstAmount = new Prisma.Decimal(0);
    const total = subtotal;
    return { priced, subtotal, gstAmount, total };
  }

  /**
   * Locks every product row involved (ascending id order, so two
   * concurrent checkouts touching an overlapping set of products can never
   * deadlock), re-checks stock one last time under the lock (it may have
   * shrunk since priceCart's own read), decrements it, and creates the
   * order + order items - all inside the caller's own transaction.
   */
  private async decrementStockAndCreateOrder(
    tx: Prisma.TransactionClient,
    userId: number,
    priced: Awaited<ReturnType<StationeryService['priceCart']>>['priced'],
    subtotal: Prisma.Decimal,
    gstAmount: Prisma.Decimal,
    total: Prisma.Decimal,
    paymentMethod: 'wallet' | 'razorpay',
    extra: { walletTransactionId?: number; razorpayOrderId?: string; razorpayPaymentId?: string; razorpaySignature?: string },
  ) {
    const sortedIds = [...priced.map((p) => p.product_id)].sort((a, b) => a - b);
    const locked = await tx.$queryRaw<Array<{ id: number; stock_quantity: number; name: string }>>(
      Prisma.sql`SELECT id, stock_quantity, name FROM stationery_products WHERE id IN (${Prisma.join(sortedIds)}) ORDER BY id FOR UPDATE`,
    );
    const stockById = new Map(locked.map((r) => [r.id, r]));

    for (const line of priced) {
      const row = stockById.get(line.product_id);
      if (!row || row.stock_quantity < line.quantity) {
        throw new UnprocessableEntityException({
          message: `Only ${row?.stock_quantity ?? 0} left of "${line.product_name}" - please update your cart`,
          errorCode: 'INSUFFICIENT_STOCK',
        });
      }
    }

    for (const line of priced) {
      await tx.stationery_products.update({
        where: { id: line.product_id },
        data: { stock_quantity: { decrement: line.quantity } },
      });
    }

    const order = await tx.stationery_orders.create({
      data: {
        user_id: userId,
        status: 'confirmed',
        subtotal,
        gst_amount: gstAmount,
        total_amount: total,
        payment_method: paymentMethod,
        payment_status: 'paid',
        confirmed_at: new Date(),
        wallet_transaction_id: extra.walletTransactionId ?? null,
        razorpay_order_id: extra.razorpayOrderId ?? null,
        razorpay_payment_id: extra.razorpayPaymentId ?? null,
        razorpay_signature: extra.razorpaySignature ?? null,
      },
    });

    await tx.stationery_order_items.createMany({
      data: priced.map((line) => ({
        order_id: order.id,
        product_id: line.product_id,
        product_name: line.product_name,
        unit_price: line.unit_price,
        quantity: line.quantity,
        subtotal: line.subtotal,
      })),
    });

    // Guaranteed-unique, no collision retry needed - the order's own PK.
    const pickupToken = `ST-${String(order.id).padStart(4, '0')}`;
    return tx.stationery_orders.update({
      where: { id: order.id },
      data: { pickup_token: pickupToken },
      include: { stationery_order_items: true },
    });
  }

  // ── Checkout: wallet (synchronous) ──────────────────────────────────────

  /**
   * POST /me/stationery/checkout/wallet - prices the cart, debits the
   * wallet (PIN-gated, see WalletService.debitForPurchase), decrements
   * stock and creates the order, all as one atomic unit: if the stock
   * re-check under lock fails after the wallet's already been debited,
   * the whole DB transaction (order + stock) rolls back, but the wallet
   * debit itself (a separate service call, already committed) does not -
   * that gap is deliberately narrow (stock only shrinks between priceCart's
   * read and this transaction's lock if another checkout is racing at the
   * exact same moment) and is surfaced as a real error for support to
   * refund rather than silently retried, same philosophy as fee-payment's
   * own documented AMOUNT_EXCEEDS_OUTSTANDING race.
   */
  async checkoutWithWallet(userId: number, dto: CheckoutWalletDto) {
    const { priced, subtotal, gstAmount, total } = await this.priceCart(dto.items);
    const outletId = await this.getOutletId();

    const { transactionId } = await this.walletService.debitForPurchase(
      userId,
      dto.pin,
      Number(total),
      outletId,
      `Stationery Store purchase - ${priced.length} item${priced.length === 1 ? '' : 's'}`,
    );

    try {
      return await this.prisma.$transaction((tx) =>
        this.decrementStockAndCreateOrder(tx, userId, priced, subtotal, gstAmount, total, 'wallet', {
          walletTransactionId: transactionId,
        }),
      );
    } catch (err) {
      this.logger.error(
        `Wallet debited (txn=${transactionId}) but order creation failed for user=${userId} - needs manual reconciliation`,
        err,
      );
      throw err;
    }
  }

  // ── Checkout: Razorpay (two-step, same shape as fee payments/wallet topup) ──

  /**
   * POST /me/stationery/checkout/razorpay-order - stages a Razorpay order.
   * Deliberately does NOT touch stock yet (only verifyRazorpayPayment does,
   * once payment is confirmed) - an abandoned or failed Razorpay checkout
   * never reserves inventory.
   */
  async createRazorpayOrder(userId: number, dto: CheckoutRazorpayOrderDto) {
    const { priced, subtotal, gstAmount, total } = await this.priceCart(dto.items);

    const razorpay = this.getRazorpay();
    const order = await razorpay.orders.create({
      amount: Math.round(Number(total) * 100), // rupees -> paise
      currency: 'INR',
      receipt: `stationery-${userId}-${Date.now()}`,
    });

    // The priced lines are written as real order items right away (status
    // stays 'pending' on the order itself) - verifyRazorpayPayment re-reads
    // these from the DB rather than trusting anything the client sends back
    // at verify time, and re-checks stock under lock before ever
    // decrementing it.
    const staged = await this.prisma.stationery_orders.create({
      data: {
        user_id: userId,
        status: 'pending',
        subtotal,
        gst_amount: gstAmount,
        total_amount: total,
        payment_method: 'razorpay',
        payment_status: 'pending',
        razorpay_order_id: order.id,
      },
    });
    await this.prisma.stationery_order_items.createMany({
      data: priced.map((line) => ({
        order_id: staged.id,
        product_id: line.product_id,
        product_name: line.product_name,
        unit_price: line.unit_price,
        quantity: line.quantity,
        subtotal: line.subtotal,
      })),
    });

    return {
      order_id: order.id,
      amount: Number(total),
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
    };
  }

  /**
   * POST /me/stationery/checkout/razorpay-verify - recomputes the
   * HMAC-SHA256 signature server-side (never trusts the client's claim
   * that Checkout succeeded), same as WalletService.verifyTopup and
   * FeePaymentService.verifyGatewayPayment.
   */
  async verifyRazorpayPayment(userId: number, dto: VerifyRazorpayOrderDto) {
    const order = await this.prisma.stationery_orders.findUnique({
      where: { razorpay_order_id: dto.razorpay_order_id },
    });
    if (!order || order.user_id !== userId) {
      throw new NotFoundException({
        message: 'No matching order found for your account',
        errorCode: 'GATEWAY_ORDER_NOT_FOUND',
      });
    }
    if (order.payment_status !== 'pending') {
      throw new BadRequestException({
        message: 'This order has already been processed',
        errorCode: 'ALREADY_PROCESSED',
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
      await this.prisma.stationery_orders.update({
        where: { id: order.id },
        data: {
          payment_status: 'failed',
          razorpay_payment_id: dto.razorpay_payment_id,
          razorpay_signature: dto.razorpay_signature,
        },
      });
      throw new BadRequestException({
        message: "Payment verification failed - signature doesn't match",
        errorCode: 'PAYMENT_VERIFICATION_FAILED',
      });
    }

    // Re-derive the cart from what was staged at createRazorpayOrder time
    // (never from the client) - items were already written then, only
    // stock decrement was deferred until now.
    const items = await this.prisma.stationery_order_items.findMany({
      where: { order_id: order.id },
    });
    if (items.length === 0) {
      // Defensive - should be unreachable once createRazorpayOrder always
      // writes items (see that method).
      throw new InternalServerErrorException({
        message: 'Order has no items to fulfil',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    try {
      const confirmed = await this.prisma.$transaction(async (tx) => {
        const sortedIds = [...new Set(items.map((i) => i.product_id))].sort((a, b) => a - b);
        const locked = await tx.$queryRaw<Array<{ id: number; stock_quantity: number; name: string }>>(
          Prisma.sql`SELECT id, stock_quantity, name FROM stationery_products WHERE id IN (${Prisma.join(sortedIds)}) ORDER BY id FOR UPDATE`,
        );
        const stockById = new Map(locked.map((r) => [r.id, r]));
        for (const item of items) {
          const row = stockById.get(item.product_id);
          if (!row || row.stock_quantity < item.quantity) {
            throw new UnprocessableEntityException({
              message: `Only ${row?.stock_quantity ?? 0} left of "${item.product_name}" - your payment will be refunded`,
              errorCode: 'INSUFFICIENT_STOCK',
            });
          }
        }
        for (const item of items) {
          await tx.stationery_products.update({
            where: { id: item.product_id },
            data: { stock_quantity: { decrement: item.quantity } },
          });
        }
        const pickupToken = `ST-${String(order.id).padStart(4, '0')}`;
        return tx.stationery_orders.update({
          where: { id: order.id },
          data: {
            status: 'confirmed',
            payment_status: 'paid',
            confirmed_at: new Date(),
            pickup_token: pickupToken,
            razorpay_payment_id: dto.razorpay_payment_id,
            razorpay_signature: dto.razorpay_signature,
          },
          include: { stationery_order_items: true },
        });
      });
      return confirmed;
    } catch (err) {
      // The money has already been charged by Razorpay - mark the order
      // failed for manual reconciliation/refund rather than leaving it
      // stuck 'pending' forever, same as FeePaymentService's identical
      // catch block.
      await this.prisma.stationery_orders.update({
        where: { id: order.id },
        data: {
          payment_status: 'failed',
          razorpay_payment_id: dto.razorpay_payment_id,
          razorpay_signature: dto.razorpay_signature,
        },
      });
      throw err;
    }
  }

  // ── Order history (any authenticated role, self-scoped) ─────────────────

  /** GET /me/stationery/orders */
  async listMyOrders(userId: number) {
    return this.prisma.stationery_orders.findMany({
      where: { user_id: userId, NOT: { status: 'pending', payment_status: 'pending' } },
      include: { stationery_order_items: true },
      orderBy: { created_at: 'desc' },
    });
  }

  /** GET /me/stationery/orders/:id */
  async getMyOrder(userId: number, orderId: number) {
    const order = await this.prisma.stationery_orders.findUnique({
      where: { id: orderId },
      include: { stationery_order_items: true },
    });
    if (!order || order.user_id !== userId) {
      throw new NotFoundException({
        message: 'Order not found',
        errorCode: 'ORDER_NOT_FOUND',
      });
    }
    return order;
  }

  // ── Admin/counter-staff (ROLES.STATIONERY, ROLES.ADMIN) ──────────────────

  /**
   * Batch-resolves a display name + register number for a set of order
   * user_ids in one query (not per-order) - same
   * `students.soa_applications.first_name/last_name` + `students.register_no`
   * join FeePaymentService already uses for admin-facing student names.
   * Falls back to the order's own email when the buyer isn't a student row
   * (the Stationery Store is open to every role, not just students).
   */
  private async attachCustomerInfo<T extends { user_id: number; users: { email: string } }>(
    orders: T[],
  ): Promise<(T & { customer_name: string | null; register_no: string | null })[]> {
    const userIds = [...new Set(orders.map((o) => o.user_id))];
    const students = await this.prisma.students.findMany({
      where: { user_id: { in: userIds } },
      select: { user_id: true, register_no: true, soa_applications: { select: { first_name: true, last_name: true } } },
    });
    const byUserId = new Map(students.map((s) => [s.user_id, s]));
    return orders.map((o) => {
      const student = byUserId.get(o.user_id);
      const name = student?.soa_applications
        ? [student.soa_applications.first_name, student.soa_applications.last_name].filter(Boolean).join(' ')
        : null;
      return { ...o, customer_name: name || null, register_no: student?.register_no ?? null };
    });
  }

  /** GET /stationery/admin/products - includes inactive products, unlike the public catalogue. */
  async listAllProducts() {
    return this.prisma.stationery_products.findMany({ orderBy: [{ category: 'asc' }, { name: 'asc' }] });
  }

  /** POST /stationery/admin/products */
  async createProduct(userId: number, dto: CreateStationeryProductDto) {
    if (dto.original_price !== undefined && dto.original_price <= dto.price) {
      throw new BadRequestException({
        message: 'original_price must be greater than price',
        errorCode: 'INVALID_ORIGINAL_PRICE',
      });
    }
    return this.prisma.stationery_products.create({
      data: {
        category: dto.category,
        name: dto.name,
        description: dto.description,
        specs: dto.specs ?? [],
        price: dto.price,
        original_price: dto.original_price,
        stock_quantity: dto.stock_quantity,
        image_url: dto.image_url,
        low_stock_threshold: dto.low_stock_threshold,
        created_by_user_id: userId,
      },
    });
  }

  /** PATCH /stationery/admin/products/:id */
  async updateProduct(id: number, dto: UpdateStationeryProductDto) {
    const existing = await this.prisma.stationery_products.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Product not found', errorCode: 'PRODUCT_NOT_FOUND' });
    }
    const nextPrice = dto.price ?? Number(existing.price);
    const nextOriginal = dto.original_price ?? (existing.original_price ? Number(existing.original_price) : undefined);
    if (nextOriginal !== undefined && nextOriginal <= nextPrice) {
      throw new BadRequestException({
        message: 'original_price must be greater than price',
        errorCode: 'INVALID_ORIGINAL_PRICE',
      });
    }
    return this.prisma.stationery_products.update({
      where: { id },
      data: {
        ...dto,
        updated_at: new Date(),
      },
    });
  }

  /**
   * DELETE /stationery/admin/products/:id - soft delete only (is_active =
   * false). A hard delete would violate stationery_order_items' own
   * ON DELETE RESTRICT the moment this product appears on any past order,
   * and even for a never-ordered product, soft delete keeps the catalogue's
   * history/audit trail intact.
   */
  async deactivateProduct(id: number) {
    const existing = await this.prisma.stationery_products.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Product not found', errorCode: 'PRODUCT_NOT_FOUND' });
    }
    return this.prisma.stationery_products.update({
      where: { id },
      data: { is_active: false, updated_at: new Date() },
    });
  }

  /** GET /stationery/admin/orders?status= */
  async listAllOrders(status?: string) {
    const orders = await this.prisma.stationery_orders.findMany({
      where: {
        NOT: { status: 'pending', payment_status: 'pending' },
        ...(status ? { status: status as stationery_order_status_enum } : {}),
      },
      include: {
        stationery_order_items: true,
        users: { select: { id: true, email: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    return this.attachCustomerInfo(orders);
  }

  /** GET /stationery/admin/orders/:id - the order drawer's own detail fetch. */
  async getOrderForAdmin(orderId: number) {
    const order = await this.prisma.stationery_orders.findUnique({
      where: { id: orderId },
      include: {
        stationery_order_items: true,
        users: { select: { id: true, email: true } },
      },
    });
    if (!order) {
      throw new NotFoundException({ message: 'Order not found', errorCode: 'ORDER_NOT_FOUND' });
    }
    const [enriched] = await this.attachCustomerInfo([order]);
    return enriched;
  }

  /**
   * GET /stationery/admin/dashboard - summary cards, recent orders, low
   * stock and a 7-day sales trend, all computed from the same two tables
   * the Products/Orders pages already query (no new tables).
   */
  async getDashboard() {
    const [products, orders] = await Promise.all([
      this.prisma.stationery_products.findMany(),
      this.prisma.stationery_orders.findMany({
        where: { NOT: { status: 'pending', payment_status: 'pending' } },
        include: { stationery_order_items: true, users: { select: { id: true, email: true } } },
        orderBy: { created_at: 'desc' },
      }),
    ]);

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayOrders = orders.filter((o) => o.created_at >= startOfToday);
    const todaySales = todayOrders.reduce((sum, o) => sum + Number(o.total_amount), 0);
    const pendingOrders = orders.filter((o) => o.status === 'pending' || o.status === 'confirmed');
    const lowStock = products
      .filter((p) => p.is_active && p.stock_quantity > 0 && p.stock_quantity <= p.low_stock_threshold)
      .sort((a, b) => a.stock_quantity - b.stock_quantity)
      .slice(0, 5);

    const salesLast7Days: { date: string; amount: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const day = new Date(startOfToday);
      day.setDate(day.getDate() - i);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      const amount = orders
        .filter((o) => o.created_at >= day && o.created_at < next)
        .reduce((sum, o) => sum + Number(o.total_amount), 0);
      salesLast7Days.push({ date: day.toISOString().slice(0, 10), amount });
    }

    const recentOrders = await this.attachCustomerInfo(orders.slice(0, 5));

    return {
      summary: {
        total_products: products.length,
        active_products: products.filter((p) => p.is_active).length,
        today_sales: todaySales,
        today_orders: todayOrders.length,
        pending_orders: pendingOrders.length,
      },
      recent_orders: recentOrders,
      low_stock_products: lowStock,
      sales_last_7_days: salesLast7Days,
    };
  }

  /**
   * GET /stationery/admin/reports?range=today|week|month - metrics,
   * top-selling products and category-wise sales, filtered to orders
   * created within the requested range.
   */
  async getReports(range: 'today' | 'week' | 'month' | 'all' = 'all') {
    let since: Date | undefined;
    if (range !== 'all') {
      since = new Date();
      since.setHours(0, 0, 0, 0);
      if (range === 'week') since.setDate(since.getDate() - 6);
      if (range === 'month') since.setDate(since.getDate() - 29);
    }

    const orders = await this.prisma.stationery_orders.findMany({
      where: {
        NOT: { status: 'pending', payment_status: 'pending' },
        ...(since ? { created_at: { gte: since } } : {}),
      },
      include: { stationery_order_items: true },
    });

    const completed = orders.filter((o) => o.status === 'collected');
    const cancelled = orders.filter((o) => o.status === 'cancelled');
    const totalSales = orders.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + Number(o.total_amount), 0);

    const unitsByProduct = new Map<number, { name: string; units: number }>();
    const salesByCategory = new Map<string, number>();
    const products = await this.prisma.stationery_products.findMany({ select: { id: true, name: true, category: true } });
    const productById = new Map(products.map((p) => [p.id, p]));

    for (const order of orders) {
      if (order.status === 'cancelled') continue;
      for (const item of order.stationery_order_items) {
        const existing = unitsByProduct.get(item.product_id);
        unitsByProduct.set(item.product_id, {
          name: item.product_name,
          units: (existing?.units ?? 0) + item.quantity,
        });
        const category = productById.get(item.product_id)?.category;
        if (category) {
          salesByCategory.set(category, (salesByCategory.get(category) ?? 0) + Number(item.subtotal));
        }
      }
    }

    const topProducts = [...unitsByProduct.values()].sort((a, b) => b.units - a.units).slice(0, 5);
    const categorySales = [...salesByCategory.entries()]
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);

    return {
      metrics: {
        total_sales: totalSales,
        total_orders: orders.length,
        completed: completed.length,
        cancelled: cancelled.length,
      },
      top_products: topProducts,
      category_sales: categorySales,
    };
  }

  /**
   * PATCH /stationery/admin/orders/:id/status - the counter's own
   * fulfilment workflow (confirmed -> preparing -> ready_for_pickup ->
   * collected), plus cancel. Only a paid order can be advanced or
   * cancelled - counter staff have nothing to act on for an order still
   * mid-checkout.
   */
  async updateOrderStatus(orderId: number, dto: UpdateOrderStatusDto) {
    const order = await this.prisma.stationery_orders.findUnique({ where: { id: orderId } });
    if (!order) {
      throw new NotFoundException({ message: 'Order not found', errorCode: 'ORDER_NOT_FOUND' });
    }
    if (order.payment_status !== 'paid') {
      throw new ForbiddenException({
        message: 'This order has not been paid for yet',
        errorCode: 'ORDER_NOT_PAID',
      });
    }
    if (order.status === 'collected' || order.status === 'cancelled') {
      throw new BadRequestException({
        message: `Order is already ${order.status}`,
        errorCode: 'ORDER_ALREADY_FINAL',
      });
    }

    const timestampField =
      dto.status === 'ready_for_pickup'
        ? { ready_at: new Date() }
        : dto.status === 'collected'
          ? { collected_at: new Date() }
          : dto.status === 'cancelled'
            ? { cancelled_at: new Date(), cancel_reason: dto.cancel_reason }
            : {};

    // Cancelling a paid order releases its stock back to the shelf (the
    // only path that ever increments stock, mirroring the decrement at
    // checkout exactly) and refunds the payment. Wallet: real, immediate
    // credit-back via WalletService.refundPurchase. Razorpay: there is no
    // live gateway refund call here (a real refund API integration is a
    // separate, larger scope than this cancel action) - marked
    // payment_status='refunded' so it's flagged for finance to action
    // manually, same "surface it, don't silently swallow it" philosophy as
    // this app's other payment-gap edge cases (e.g. FeePaymentService's
    // AMOUNT_EXCEEDS_OUTSTANDING race).
    if (dto.status === 'cancelled') {
      const items = await this.prisma.stationery_order_items.findMany({ where: { order_id: orderId } });
      await this.prisma.$transaction(async (tx) => {
        for (const item of items) {
          await tx.stationery_products.update({
            where: { id: item.product_id },
            data: { stock_quantity: { increment: item.quantity } },
          });
        }
        await tx.stationery_orders.update({
          where: { id: orderId },
          data: {
            status: dto.status,
            payment_status: 'refunded',
            ...timestampField,
          },
        });
      });

      if (order.payment_method === 'wallet' && order.wallet_transaction_id) {
        await this.walletService.refundPurchase(
          order.wallet_transaction_id,
          `Refund for cancelled Stationery Store order #${orderId} (${dto.cancel_reason ?? 'no reason given'})`,
        );
      } else {
        this.logger.warn(
          `Order ${orderId} cancelled after Razorpay payment - needs a manual gateway refund (no live refund API call made here)`,
        );
      }

      return this.prisma.stationery_orders.findUnique({
        where: { id: orderId },
        include: { stationery_order_items: true },
      });
    }

    return this.prisma.stationery_orders.update({
      where: { id: orderId },
      data: { status: dto.status, ...timestampField },
      include: { stationery_order_items: true },
    });
  }
}
