import { Injectable } from '@nestjs/common';
import {
  Prisma,
  type finance_ledger_entry_type_enum,
  type finance_ledger_source_enum,
} from 'generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

export interface FinanceFundSummary {
  id: number;
  academic_year: string;
  total_amount: number;
  available_amount: number;
  committed_amount: number;
  utilisation_pct: number;
  is_locked: boolean;
}

export interface FinanceDashboardView {
  /**
   * Institution-wide position across EVERY fund year, not just one.
   *
   * This previously reported a single `findFirst` row, so an institution with a
   * ₹50L year and a ₹10L year saw only ₹10L on the dashboard — the newest year
   * won and the rest of the money was invisible. The totals below are now the
   * sum of all fund years, with `academic_year` naming the current (newest
   * unlocked) one purely as a label.
   */
  fund: {
    academic_year: string | null;
    total_amount: number;
    available_amount: number;
    committed_amount: number;
    utilisation_pct: number;
    is_locked: boolean;
    /** How many fund years the totals above span. */
    year_count: number;
  } | null;
  /** Per-year breakdown, so each year's own figures are visible too. */
  fund_years: FinanceFundSummary[];
  queues: {
    pop_pending: number;
    sop_pending: number;
    pop_approved: number;
    sop_approved: number;
    rejected: number;
  };
  delivery: {
    awaiting_dispatch: number;
    in_transit: number;
    delivered: number;
    pending_allotment: number;
    cancelled: number;
  };
  spend: {
    /** Debits only, i.e. money actually committed out of the fund. */
    committed_this_year: number;
    last_30_days: number;
    by_month: Array<{ month: string; amount: number }>;
  };
  recent_movements: Array<{
    id: string;
    entry_type: string;
    source: string;
    amount: number;
    narration: string;
    created_at: string;
  }>;
  top_departments: Array<{ department: string; amount: number; orders: number }>;
}

@Injectable()
export class FinanceDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /finance/dashboard — every figure below is derived from real rows;
   * nothing is sampled or hardcoded. Queries run in parallel because none of
   * them depends on another's result.
   */
  async overview(): Promise<FinanceDashboardView> {
    // Every fund year, so the headline figures cover the whole institution
    // rather than whichever year happens to sort last.
    const allFunds = await this.prisma.finance_funds.findMany({
      orderBy: { academic_year: 'desc' },
    });

    const fundYears: FinanceFundSummary[] = allFunds.map((f) => {
      const total = Number(f.total_amount);
      const available = Number(f.available_amount);
      const committed = Math.max(0, total - available);
      return {
        id: f.id,
        academic_year: f.academic_year,
        total_amount: total,
        available_amount: available,
        committed_amount: committed,
        utilisation_pct: total > 0 ? Math.round((committed / total) * 1000) / 10 : 0,
        is_locked: f.is_locked,
      };
    });

    // The newest unlocked year is "current" — used only as a label and as the
    // default target for new approvals.
    const currentFund = allFunds.find((f) => !f.is_locked) ?? allFunds[0] ?? null;

    // Connection discipline matters here: this database is reached through a
    // session-mode pooler capped at 15 clients, so firing ten queries at once
    // can exhaust the pool and fail the whole dashboard. Instead the six
    // status counts collapse into two groupBy round-trips, and the remaining
    // work runs in small batches — at most three connections at a time.
    const [popByStatus, sopByStatus] = await Promise.all([
      this.prisma.purchase_order_proposals.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.service_order_proposals.groupBy({ by: ['status'], _count: { _all: true } }),
    ]);

    const countOf = (
      groups: Array<{ status: string; _count: { _all: number } }>,
      status: string,
    ): number => groups.find((g) => g.status === status)?._count._all ?? 0;

    const popPending = countOf(popByStatus, 'pending');
    const sopPending = countOf(sopByStatus, 'pending');
    const popApproved = countOf(popByStatus, 'finance_approved');
    const sopApproved = countOf(sopByStatus, 'finance_approved');
    const popRejected = countOf(popByStatus, 'rejected');
    const sopRejected = countOf(sopByStatus, 'rejected');

    const [trackingRows, ledgerRows, recent] = await Promise.all([
      this.prisma.finance_order_tracking.findMany({
        select: {
          delivery_status: true,
          quantity_delivered: true,
          finance_order_allotments: { select: { quantity: true } },
        },
      }),
      // Spend and movements span every fund year, matching the totals above.
      this.prisma.finance_ledger_entries.findMany({
        where: { entry_type: 'debit' },
        select: { amount: true, created_at: true },
      }),
      this.prisma.finance_ledger_entries.findMany({
        orderBy: { created_at: 'desc' },
        take: 8,
        select: {
          id: true,
          entry_type: true,
          source: true,
          amount: true,
          narration: true,
          created_at: true,
        },
      }),
    ]);

    // Institution-wide totals: the sum of every fund year.
    const total = fundYears.reduce((s, f) => s + f.total_amount, 0);
    const available = fundYears.reduce((s, f) => s + f.available_amount, 0);
    const committed = Math.max(0, total - available);

    // Delivery funnel. "Pending allotment" is the actionable one: delivered
    // stock that nobody has been handed yet.
    const delivery = {
      awaiting_dispatch: 0,
      in_transit: 0,
      delivered: 0,
      pending_allotment: 0,
      cancelled: 0,
    };
    for (const t of trackingRows) {
      if (t.delivery_status === 'ordered') delivery.awaiting_dispatch += 1;
      else if (t.delivery_status === 'dispatched' || t.delivery_status === 'in_transit')
        delivery.in_transit += 1;
      else if (t.delivery_status === 'cancelled') delivery.cancelled += 1;
      else {
        delivery.delivered += 1;
        const allotted = t.finance_order_allotments.reduce((s, a) => s + a.quantity, 0);
        if (t.quantity_delivered > 0 && allotted < t.quantity_delivered) {
          delivery.pending_allotment += 1;
        }
      }
    }

    const topDepartments = await this.topDepartments();

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    let last30 = 0;
    const monthly = new Map<string, number>();
    for (const l of ledgerRows) {
      const amt = Number(l.amount);
      if (l.created_at >= thirtyDaysAgo) last30 += amt;
      const key = `${l.created_at.getFullYear()}-${String(l.created_at.getMonth() + 1).padStart(2, '0')}`;
      monthly.set(key, (monthly.get(key) ?? 0) + amt);
    }

    return {
      fund: currentFund
        ? {
            academic_year: currentFund.academic_year,
            total_amount: total,
            available_amount: available,
            committed_amount: committed,
            utilisation_pct: total > 0 ? Math.round((committed / total) * 1000) / 10 : 0,
            is_locked: currentFund.is_locked,
            year_count: fundYears.length,
          }
        : null,
      fund_years: fundYears,
      queues: {
        pop_pending: popPending,
        sop_pending: sopPending,
        pop_approved: popApproved,
        sop_approved: sopApproved,
        rejected: popRejected + sopRejected,
      },
      delivery,
      spend: {
        committed_this_year: ledgerRows.reduce((s, l) => s + Number(l.amount), 0),
        last_30_days: last30,
        by_month: [...monthly.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .slice(-6)
          .map(([month, amount]) => ({ month, amount })),
      },
      recent_movements: recent.map((r) => ({
        id: r.id.toString(),
        entry_type: r.entry_type,
        source: r.source,
        amount: Number(r.amount),
        narration: r.narration,
        created_at: r.created_at.toISOString(),
      })),
      // Awaited separately (not inside the batch above) to keep the number of
      // simultaneous pooler connections low — see the note further up.
      top_departments: topDepartments,
    };
  }

  /**
   * Which departments Finance has committed the most money to. Joined through
   * the proposal -> indent -> department chain of the debit entries, so the
   * figures are the real approved amounts, not indent estimates.
   */
  private async topDepartments() {
    const debits = await this.prisma.finance_ledger_entries.findMany({
      where: { entry_type: 'debit', source: { in: ['pop_approval', 'sop_approval'] } },
      select: {
        amount: true,
        purchase_order_proposals: {
          select: { purchase_indents: { select: { departments: { select: { name: true } } } } },
        },
        service_order_proposals: {
          select: { service_indents: { select: { departments: { select: { name: true } } } } },
        },
      },
    });

    const totals = new Map<string, { amount: number; orders: number }>();
    for (const d of debits) {
      const name =
        d.purchase_order_proposals?.purchase_indents?.departments?.name ??
        d.service_order_proposals?.service_indents?.departments?.name;
      if (!name) continue;
      const prev = totals.get(name) ?? { amount: 0, orders: 0 };
      totals.set(name, { amount: prev.amount + Number(d.amount), orders: prev.orders + 1 });
    }

    return [...totals.entries()]
      .map(([department, v]) => ({ department, amount: v.amount, orders: v.orders }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);
  }
}
