import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import Razorpay from 'razorpay';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { CreateStationaryOrderDto } from './dto/create-stationary-order.dto';
import { VerifyStationaryPaymentDto } from './dto/verify-stationary-payment.dto';
import { UpdateStationaryRequestStatusDto } from './dto/update-stationary-request-status.dto';
import { CreateCounterEntryDto } from './dto/create-counter-entry.dto';
import { UpdateStockItemDto } from './dto/update-stock-item.dto';
import { CreateMachineDto, UpdateMachineDto } from './dto/machine.dto';
import { CreatePrintRateDto, UpdatePrintRateDto } from './dto/print-rate.dto';
import { CreateFinishingRateDto, UpdateFinishingRateDto } from './dto/finishing-rate.dto';

// ₹2 per printed page - the only pricing rule this module implements.
// Binding/paper size/sides/color are all stored for the print shop's own
// reference but don't change the price (no per-binding/per-color rate has
// ever been specified for this module).
const PRICE_PER_PAGE = 2;

type StationaryRequestRow = {
  id: number;
  // Null exactly for a counter/walk-in entry (see createCounterEntry) - a
  // real online order always has one, checked server-side, never a
  // walk-in-and-online-order hybrid.
  user_id: number | null;
  walkin_requester_name: string | null;
  walkin_department: string | null;
  // The pre-existing column from this table's original design (a single
  // file's name) - reused as-is to hold whatever short summary the client
  // sends for its (possibly multi-file) request, rather than adding yet
  // another near-duplicate column.
  file_name: string | null;
  total_pages: number;
  copies: number;
  orientation: string;
  color_mode: string;
  paper_size: string | null;
  sides: string | null;
  binding: string | null;
  specification: string | null;
  amount: string;
  status:
    | 'pending_payment'
    | 'paid'
    | 'processing'
    | 'ready_for_pickup'
    | 'completed'
    | 'rejected';
  rejection_reason: string | null;
  razorpay_order_id: string | null;
  razorpay_payment_id: string | null;
  created_at: Date;
  updated_at: Date;
};

type StationaryRequestWithRequester = StationaryRequestRow & {
  requester_email: string | null;
  requester_role: string | null;
};

// A vendor may only move a request FORWARD along one real path (or sideways
// into rejected) - never resurrect a completed/rejected request, and never
// touch a request that isn't paid yet (that's the student payment flow's
// own territory, see createOrder/verifyPayment above).
const VENDOR_ALLOWED_TRANSITIONS: Record<string, readonly string[]> = {
  paid: ['processing', 'rejected'],
  processing: ['ready_for_pickup', 'rejected'],
  ready_for_pickup: ['completed', 'rejected'],
};

// stationary_requests is a manual-SQL table (see
// prisma/manual-sql/stationary_requests.sql) - not a schema.prisma model,
// per this project's "never modify schema.prisma for a small additive
// table" convention - so every query here is raw SQL via PrismaService's
// $queryRaw/$executeRaw, same pattern as Medical Centre's raw-SQL tables.
@Injectable()
export class StationaryService {
  private readonly logger = new Logger(StationaryService.name);
  private razorpay: Razorpay | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Every paid online print request ends by calling this - broadcasts to
   * every STATIONARY/ADMIN-role user (a global role with no per-request
   * assignee), same "notifyRoleUsers" broadcast pattern AppraisalService
   * uses for HR Payroll and the Stationery Store's own identical helper.
   * Best-effort: a failed notify must never fail the payment verification
   * itself, which has already succeeded by the time this runs.
   */
  private async notifyStationaryAdmins(requestId: number, amount: string | number) {
    try {
      const admins = await this.prisma.users.findMany({
        where: { roles: { name: { in: [ROLES.STATIONARY, ROLES.ADMIN] } } },
        select: { id: true },
      });
      for (const admin of admins) {
        await this.notifications.notify({
          user_id: admin.id,
          title: 'New print request',
          message: `Print request #${requestId} (₹${amount}) was just paid and sent to the print shop.`,
        });
      }
    } catch (err) {
      this.logger.error(`Failed to notify Stationary admins of request ${requestId}`, err);
    }
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
   * POST /me/stationary-requests/order — creates a Razorpay order and a
   * matching `pending_payment` stationary_requests row. The request is
   * only ever marked paid later, by verifyPayment(), once the signature is
   * independently confirmed - mirrors WalletService.createTopupOrder.
   */
  async createOrder(userId: number, dto: CreateStationaryOrderDto) {
    const amount = dto.total_pages * dto.copies * PRICE_PER_PAGE;
    const razorpay = this.getRazorpay();

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // rupees -> paise
      currency: 'INR',
      receipt: `stationary-${userId}-${Date.now()}`,
    });

    try {
      // `pages` (all/even/odd) is a leftover NOT NULL column from this
      // table's original design - the new UI has no equivalent concept
      // (total_pages replaces it), so every new row just gets the 'all'
      // default to satisfy the existing constraint without resurrecting
      // that old selector anywhere.
      await this.prisma.$executeRaw`
        INSERT INTO stationary_requests
          (user_id, file_name, total_pages, copies, orientation, color_mode, pages, paper_size, sides, binding, amount, status, razorpay_order_id, payment_mode)
        VALUES
          (${userId}, ${dto.file_summary ?? null}, ${dto.total_pages}, ${dto.copies}, ${dto.orientation}, ${dto.color_mode}, 'all', ${dto.paper_size}, ${dto.sides}, ${dto.binding}, ${amount}, 'pending_payment', ${order.id}, 'online')
      `;
    } catch (err) {
      this.logger.error('DB error while creating stationary request', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    return {
      order_id: order.id,
      amount,
      currency: 'INR',
      key_id: process.env.RAZORPAY_KEY_ID,
    };
  }

  /**
   * POST /me/stationary-requests/order/verify — recomputes the
   * HMAC-SHA256 signature server-side (order_id|payment_id, signed with
   * the key secret) rather than trusting the client's claim that Checkout
   * succeeded. Only marks the request paid on a genuine signature match -
   * mirrors WalletService.verifyTopup.
   */
  async verifyPayment(userId: number, dto: VerifyStationaryPaymentDto) {
    const rows = await this.prisma.$queryRaw<StationaryRequestRow[]>`
      SELECT * FROM stationary_requests WHERE razorpay_order_id = ${dto.razorpay_order_id}
    `;
    const request = rows[0];
    if (!request || request.user_id !== userId) {
      throw new NotFoundException({
        message: 'No matching stationary request found for your account',
        errorCode: 'STATIONARY_REQUEST_NOT_FOUND',
      });
    }
    if (request.status !== 'pending_payment') {
      throw new BadRequestException({
        message: 'This request has already been processed',
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
      await this.prisma.$executeRaw`
        UPDATE stationary_requests
        SET razorpay_payment_id = ${dto.razorpay_payment_id}, razorpay_signature = ${dto.razorpay_signature}, updated_at = now()
        WHERE id = ${request.id}
      `;
      throw new BadRequestException({
        message: "Payment verification failed - signature doesn't match",
        errorCode: 'PAYMENT_VERIFICATION_FAILED',
      });
    }

    await this.prisma.$executeRaw`
      UPDATE stationary_requests
      SET status = 'paid', razorpay_payment_id = ${dto.razorpay_payment_id}, razorpay_signature = ${dto.razorpay_signature}, updated_at = now()
      WHERE id = ${request.id}
    `;

    this.logger.log(`Stationary request paid: id=${request.id} amount=${request.amount}`);

    try {
      // No dedicated notification_type_enum value exists for this yet (see
      // that enum in schema.prisma, which this project's convention says
      // never to hand-edit for something this small) - omitting `type`
      // just means a generic icon/no deep link, the same documented
      // fallback CreateNotificationDto already supports.
      await this.notifications.notify({
        user_id: userId,
        title: 'Stationary request paid',
        message: `Your print request (₹${request.amount}) has been paid and sent to the print shop.`,
      });
    } catch (err) {
      this.logger.error(`Failed to notify user ${userId} of stationary payment`, err);
    }
    await this.notifyStationaryAdmins(request.id, request.amount);

    return { id: request.id, amount: Number(request.amount), status: 'paid' as const };
  }

  /** GET /me/stationary-requests — the caller's own request history, newest first. */
  async listMyRequests(userId: number) {
    const rows = await this.prisma.$queryRaw<StationaryRequestRow[]>`
      SELECT * FROM stationary_requests WHERE user_id = ${userId} ORDER BY created_at DESC
    `;
    return rows.map((r) => ({
      id: r.id,
      file_summary: r.file_name,
      total_pages: r.total_pages,
      copies: r.copies,
      orientation: r.orientation,
      color_mode: r.color_mode,
      paper_size: r.paper_size,
      sides: r.sides,
      binding: r.binding,
      amount: Number(r.amount),
      status: r.status,
      rejection_reason: r.rejection_reason,
      created_at: r.created_at,
    }));
  }

  // ──────────────────────────── vendor (Stationary role) ────────────────────────────

  /**
   * GET /stationary-requests (Stationary vendor / Admin) — every request
   * across every requester, newest first, optionally filtered to one
   * status. pending_payment rows ARE included (a vendor should be able to
   * see what's still awaiting payment, just can't act on it yet - see
   * VENDOR_ALLOWED_TRANSITIONS). LEFT JOINs users/roles (not JOIN) since a
   * counter/walk-in row has no user_id at all - requester_name/
   * requester_department below prefer the real account's email/role when
   * one exists, falling back to the walk-in's typed name/department
   * otherwise. No per-role name resolution (soa_applications/faculty
   * first_name) since an online requester can be any of 20+ roles; email +
   * role label is enough for a print-shop queue.
   */
  async listAllRequests(status?: string) {
    const rows = status
      ? await this.prisma.$queryRaw<StationaryRequestWithRequester[]>`
          SELECT sr.*, u.email as requester_email, r.name as requester_role
          FROM stationary_requests sr
          LEFT JOIN users u ON u.id = sr.user_id
          LEFT JOIN roles r ON r.id = u.role_id
          WHERE sr.status = ${status}
          ORDER BY sr.created_at DESC
        `
      : await this.prisma.$queryRaw<StationaryRequestWithRequester[]>`
          SELECT sr.*, u.email as requester_email, r.name as requester_role
          FROM stationary_requests sr
          LEFT JOIN users u ON u.id = sr.user_id
          LEFT JOIN roles r ON r.id = u.role_id
          ORDER BY sr.created_at DESC
        `;

    return rows.map((r) => ({
      id: r.id,
      is_walk_in: r.user_id === null,
      requester_name: r.requester_email ?? r.walkin_requester_name,
      requester_department: r.requester_role ?? r.walkin_department,
      file_summary: r.file_name,
      total_pages: r.total_pages,
      copies: r.copies,
      orientation: r.orientation,
      color_mode: r.color_mode,
      paper_size: r.paper_size,
      sides: r.sides,
      binding: r.binding,
      specification: r.specification,
      amount: Number(r.amount),
      status: r.status,
      rejection_reason: r.rejection_reason,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  /**
   * POST /stationary-requests/counter (Stationary vendor / Admin) — logs an
   * in-person job with no linked account (see CreateCounterEntryDto's own
   * doc comment on why `amount` is trusted here, unlike the online flow).
   * Starts straight at 'paid' - a counter job has already been paid for at
   * the counter (cash/UPI/department voucher), there's no online-payment
   * step to await, so it enters the vendor queue exactly where an
   * already-paid online order does (see VENDOR_ALLOWED_TRANSITIONS).
   */
  async createCounterEntry(dto: CreateCounterEntryDto) {
    const rows = await this.prisma.$queryRaw<StationaryRequestRow[]>`
      INSERT INTO stationary_requests
        (user_id, walkin_requester_name, walkin_department, file_name, specification, total_pages, copies, orientation, color_mode, pages, amount, status, payment_mode)
      VALUES
        (NULL, ${dto.requester_name}, ${dto.department ?? null}, ${dto.document ?? null}, ${dto.specification ?? null}, 0, ${dto.copies}, 'portrait', 'bw', 'all', ${dto.amount}, 'paid', ${dto.payment_mode})
      RETURNING *
    `;
    const created = rows[0];
    return {
      id: created.id,
      is_walk_in: true,
      requester_name: created.walkin_requester_name,
      requester_department: created.walkin_department,
      file_summary: created.file_name,
      specification: created.specification,
      copies: created.copies,
      amount: Number(created.amount),
      status: created.status,
      created_at: created.created_at,
    };
  }

  /**
   * PATCH /stationary-requests/:id/status (Stationary vendor / Admin).
   * Server-enforced state machine (VENDOR_ALLOWED_TRANSITIONS) - a vendor
   * can never skip straight from paid to completed, or touch a
   * pending_payment/already-terminal request, regardless of what the
   * client sends.
   */
  async updateStatus(requestId: number, dto: UpdateStationaryRequestStatusDto) {
    const rows = await this.prisma.$queryRaw<StationaryRequestRow[]>`
      SELECT * FROM stationary_requests WHERE id = ${requestId}
    `;
    const request = rows[0];
    if (!request) {
      throw new NotFoundException({
        message: 'Stationary request not found',
        errorCode: 'STATIONARY_REQUEST_NOT_FOUND',
      });
    }

    const allowed = VENDOR_ALLOWED_TRANSITIONS[request.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException({
        message: `Cannot move a "${request.status}" request to "${dto.status}"`,
        errorCode: 'INVALID_WORKFLOW_STATE',
      });
    }

    await this.prisma.$executeRaw`
      UPDATE stationary_requests
      SET status = ${dto.status},
          rejection_reason = ${dto.status === 'rejected' ? (dto.rejection_reason ?? null) : null},
          updated_at = now()
      WHERE id = ${requestId}
    `;

    // A counter/walk-in row (user_id null) has no account to notify - the
    // vendor already told that person directly at the counter.
    if (request.user_id !== null) {
      const STATUS_MESSAGE: Record<string, string> = {
        processing: 'Your print request is now being processed.',
        ready_for_pickup: 'Your print request is ready for pickup.',
        completed: 'Your print request has been completed.',
        rejected: `Your print request was rejected${dto.rejection_reason ? `: ${dto.rejection_reason}` : '.'}`,
      };
      try {
        await this.notifications.notify({
          user_id: request.user_id,
          title: 'Stationary request update',
          message: STATUS_MESSAGE[dto.status] ?? `Your print request is now "${dto.status}".`,
        });
      } catch (err) {
        this.logger.error(`Failed to notify user ${request.user_id} of stationary status change`, err);
      }
    }

    return { id: requestId, status: dto.status };
  }

  /**
   * GET /stationary-requests/stats (Stationary vendor / Admin) — the
   * Dashboard page's 4 stat cards. total_pages is null for a counter entry
   * (see createCounterEntry) - coalesced to 0 so a walk-in job never
   * silently breaks the pages-printed-today sum.
   */
  async getDashboardStats() {
    const [pendingRow, todayRow] = await Promise.all([
      this.prisma.$queryRaw<{ count: bigint; oldest_minutes: number | null }[]>`
        SELECT COUNT(*) as count,
               EXTRACT(EPOCH FROM (now() - MIN(created_at))) / 60 as oldest_minutes
        FROM stationary_requests
        WHERE status = 'paid'
      `,
      this.prisma.$queryRaw<
        { pages_today: bigint | null; completed_today: bigint; collected_today: string | null }[]
      >`
        SELECT
          SUM(total_pages * copies) FILTER (WHERE status IN ('processing','ready_for_pickup','completed') AND created_at::date = CURRENT_DATE) as pages_today,
          COUNT(*) FILTER (WHERE status = 'completed' AND updated_at::date = CURRENT_DATE) as completed_today,
          SUM(amount) FILTER (WHERE status = 'completed' AND updated_at::date = CURRENT_DATE) as collected_today
        FROM stationary_requests
      `,
    ]);

    const pending = pendingRow[0];
    const today = todayRow[0];

    return {
      pending_count: Number(pending?.count ?? 0),
      oldest_pending_minutes: pending?.oldest_minutes != null ? Math.round(pending.oldest_minutes) : null,
      pages_printed_today: Number(today?.pages_today ?? 0),
      completed_today: Number(today?.completed_today ?? 0),
      collected_today: Number(today?.collected_today ?? 0),
    };
  }

  /** GET /stationary-requests/stock (Stationary vendor / Admin) — the Dashboard's "Stock alerts" panel. */
  async listStockItems() {
    return this.prisma.stationary_stock_items.findMany({ orderBy: { id: 'asc' } });
  }

  /** PATCH /stationary-requests/stock/:id (Stationary vendor / Admin) — vendor updates a stock count after a restock/usage count. */
  async updateStockItem(id: number, dto: UpdateStockItemDto) {
    try {
      return await this.prisma.stationary_stock_items.update({
        where: { id },
        data: { quantity_left: dto.quantity_left },
      });
    } catch {
      throw new NotFoundException({
        message: 'Stock item not found',
        errorCode: 'STOCK_ITEM_NOT_FOUND',
      });
    }
  }

  // ── Operations: Printers & Machines ────────────────────────────────────

  async listMachines() {
    return this.prisma.stationary_machines.findMany({ orderBy: { sort_order: 'asc' } });
  }

  async createMachine(dto: CreateMachineDto) {
    const max = await this.prisma.stationary_machines.aggregate({ _max: { sort_order: true } });
    return this.prisma.stationary_machines.create({
      data: { ...dto, sort_order: (max._max.sort_order ?? 0) + 1 },
    });
  }

  async updateMachine(id: number, dto: UpdateMachineDto) {
    try {
      return await this.prisma.stationary_machines.update({ where: { id }, data: dto });
    } catch {
      throw new NotFoundException({ message: 'Machine not found', errorCode: 'MACHINE_NOT_FOUND' });
    }
  }

  async deleteMachine(id: number) {
    try {
      await this.prisma.stationary_machines.delete({ where: { id } });
    } catch {
      throw new NotFoundException({ message: 'Machine not found', errorCode: 'MACHINE_NOT_FOUND' });
    }
    return { success: true };
  }

  // ── Operations: Price Detail ─────────────────────────────────────────

  async listPrintRates() {
    return this.prisma.stationary_print_rates.findMany({ orderBy: { sort_order: 'asc' } });
  }

  async createPrintRate(dto: CreatePrintRateDto) {
    const max = await this.prisma.stationary_print_rates.aggregate({ _max: { sort_order: true } });
    return this.prisma.stationary_print_rates.create({
      data: { ...dto, sort_order: (max._max.sort_order ?? 0) + 1 },
    });
  }

  async updatePrintRate(id: number, dto: UpdatePrintRateDto) {
    try {
      return await this.prisma.stationary_print_rates.update({ where: { id }, data: dto });
    } catch {
      throw new NotFoundException({ message: 'Rate not found', errorCode: 'PRINT_RATE_NOT_FOUND' });
    }
  }

  async deletePrintRate(id: number) {
    try {
      await this.prisma.stationary_print_rates.delete({ where: { id } });
    } catch {
      throw new NotFoundException({ message: 'Rate not found', errorCode: 'PRINT_RATE_NOT_FOUND' });
    }
    return { success: true };
  }

  async listFinishingRates() {
    return this.prisma.stationary_finishing_rates.findMany({ orderBy: { sort_order: 'asc' } });
  }

  async createFinishingRate(dto: CreateFinishingRateDto) {
    const max = await this.prisma.stationary_finishing_rates.aggregate({ _max: { sort_order: true } });
    return this.prisma.stationary_finishing_rates.create({
      data: { ...dto, sort_order: (max._max.sort_order ?? 0) + 1 },
    });
  }

  async updateFinishingRate(id: number, dto: UpdateFinishingRateDto) {
    try {
      return await this.prisma.stationary_finishing_rates.update({ where: { id }, data: dto });
    } catch {
      throw new NotFoundException({ message: 'Rate not found', errorCode: 'FINISHING_RATE_NOT_FOUND' });
    }
  }

  async deleteFinishingRate(id: number) {
    try {
      await this.prisma.stationary_finishing_rates.delete({ where: { id } });
    } catch {
      throw new NotFoundException({ message: 'Rate not found', errorCode: 'FINISHING_RATE_NOT_FOUND' });
    }
    return { success: true };
  }

  // ── Reports ─────────────────────────────────────────────────────────

  /** Defaults to month-to-date when either bound is omitted — matches the design's own default range. */
  private resolveReportRange(from?: string, to?: string): { start: Date; end: Date } {
    const now = new Date();
    const start = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    // `to` is a calendar day (e.g. "2026-09-15") - exclusive upper bound is the day AFTER it, so that day's own rows are included.
    const end = to ? new Date(new Date(to).getTime() + 86_400_000) : new Date(now.getTime() + 86_400_000);
    return { start, end };
  }

  /**
   * GET /stationary-requests/reports/usage-by-department — Reports page's
   * "Usage by Department" tab. Resolves each job's real department: online
   * orders via users -> students -> classes -> departments (student) or
   * users -> faculty -> departments (faculty/HoD); a walk-in's free-text
   * walkin_department is used as-is (no account to resolve a real
   * department from). Only counts jobs that actually reached the machine
   * (processing/ready_for_pickup/completed) - a still-unpaid or rejected
   * job was never printed.
   */
  async getUsageByDepartment(from?: string, to?: string) {
    const { start, end } = this.resolveReportRange(from, to);
    const rows = await this.prisma.$queryRaw<
      { department: string; jobs: bigint; pages: bigint | null; amount: string | null }[]
    >`
      WITH resolved AS (
        SELECT
          COALESCE(d.name, sr.walkin_department, 'Other') AS department,
          sr.total_pages, sr.copies, sr.amount
        FROM stationary_requests sr
        LEFT JOIN students st ON st.user_id = sr.user_id
        LEFT JOIN classes cl ON cl.id = st.class_id
        LEFT JOIN faculty fac ON fac.user_id = sr.user_id
        LEFT JOIN departments d ON d.id = COALESCE(cl.department_id, fac.department_id)
        WHERE sr.status IN ('processing', 'ready_for_pickup', 'completed')
          AND sr.created_at >= ${start} AND sr.created_at < ${end}
      )
      SELECT department, COUNT(*) as jobs, COALESCE(SUM(total_pages * copies), 0) as pages, COALESCE(SUM(amount), 0) as amount
      FROM resolved
      GROUP BY department
      ORDER BY pages DESC
    `;

    return {
      range: { start: start.toISOString(), end: new Date(end.getTime() - 86_400_000).toISOString() },
      departments: rows.map((r) => ({
        department: r.department,
        jobs: Number(r.jobs),
        pages: Number(r.pages ?? 0),
        amount: Number(r.amount ?? 0),
      })),
    };
  }

  /**
   * GET /stationary-requests/reports/revenue — Reports page's
   * "Revenue / Payments" tab. `payment_mode` is real per-job data ('online'
   * for every Razorpay order, vendor-chosen for a counter entry) - rows
   * created before this column existed have a null mode and are grouped
   * under "Unspecified" rather than guessed into a real mode.
   */
  async getRevenueReport(from?: string, to?: string) {
    const { start, end } = this.resolveReportRange(from, to);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart.getTime() + 86_400_000);

    const [monthRow, todayRow, byMode, recent] = await Promise.all([
      this.prisma.$queryRaw<{ collected: string | null; jobs: bigint }[]>`
        SELECT COALESCE(SUM(amount), 0) as collected, COUNT(*) as jobs
        FROM stationary_requests
        WHERE status = 'completed' AND updated_at >= ${start} AND updated_at < ${end}
      `,
      this.prisma.$queryRaw<{ collected: string | null; jobs: bigint }[]>`
        SELECT COALESCE(SUM(amount), 0) as collected, COUNT(*) as jobs
        FROM stationary_requests
        WHERE status = 'completed' AND updated_at >= ${todayStart} AND updated_at < ${todayEnd}
      `,
      this.prisma.$queryRaw<{ mode: string | null; amount: string | null }[]>`
        SELECT payment_mode as mode, COALESCE(SUM(amount), 0) as amount
        FROM stationary_requests
        WHERE status = 'completed' AND updated_at >= ${start} AND updated_at < ${end}
        GROUP BY payment_mode
        ORDER BY amount DESC
      `,
      this.prisma.$queryRaw<
        {
          date: Date;
          who: string | null;
          mode: string | null;
          jobs: number;
          amount: string;
        }[]
      >`
         SELECT
           sr.updated_at::date as date,
           COALESCE(u.email, sr.walkin_requester_name) as who,
           sr.payment_mode as mode,
           1 as jobs,
           sr.amount as amount
         FROM stationary_requests sr
         LEFT JOIN users u ON u.id = sr.user_id
         WHERE sr.status = 'completed' AND sr.updated_at >= ${start} AND sr.updated_at < ${end}
         ORDER BY sr.updated_at DESC
         LIMIT 20
      `,
    ]);

    const month = monthRow[0];
    const today = todayRow[0];
    const monthJobs = Number(month?.jobs ?? 0);
    const monthCollected = Number(month?.collected ?? 0);

    return {
      range: { start: start.toISOString(), end: new Date(end.getTime() - 86_400_000).toISOString() },
      collected_this_month: monthCollected,
      collected_today: Number(today?.collected ?? 0),
      jobs_today: Number(today?.jobs ?? 0),
      avg_job_value: monthJobs > 0 ? Math.round((monthCollected / monthJobs) * 100) / 100 : 0,
      by_mode: byMode.map((r) => ({ mode: r.mode ?? 'unspecified', amount: Number(r.amount ?? 0) })),
      recent_payments: recent.map((r) => ({
        date: r.date,
        who: r.who ?? 'Walk-in',
        mode: r.mode ?? 'unspecified',
        jobs: Number(r.jobs),
        amount: Number(r.amount),
      })),
    };
  }
}
