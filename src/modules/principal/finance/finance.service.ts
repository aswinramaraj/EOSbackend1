import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}
function round0(v: number): number {
  return Math.round(v);
}
function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

interface SchemeRow {
  id: number;
  name: string;
  academic_year: string;
  status: string;
}
interface AwardRow {
  scheme_id: number;
  amount: number;
}
interface BudgetAllocationRow {
  head: string;
  sanctioned_amount: number;
}

/**
 * Oversight only — transaction-level accounting stays with the Finance
 * office, per this codebase's own convention (this module never writes a
 * payment/demand row, only aggregates existing ones). Institution-wide
 * totals safely include hostel/transport fees: they ride on the exact same
 * `student_fee_demand_mapping`/`fee_payments` tables as tuition (via
 * `fee_structures.applies_to`), so a single aggregation is the one true
 * source — no separate hostel/transport sum exists or is needed.
 */
@Injectable()
export class PrincipalFinanceService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /me/principal/finance/summary */
  async summary() {
    const [demandMappings, payments, scholarships, budget, perStudentDue] =
      await Promise.all([
        this.prisma.student_fee_demand_mapping.findMany({
          select: { total_amount: true },
        }),
        this.prisma.fee_payments.findMany({ select: { amount_paid: true } }),
        this.tryLoadScholarships(),
        this.budget(),
        this.perStudentDue(),
      ]);

    const totalDemand = demandMappings.reduce(
      (sum, m) => sum + Number(m.total_amount),
      0,
    );
    const totalCollected = payments.reduce(
      (sum, p) => sum + Number(p.amount_paid),
      0,
    );
    const studentsWithDues = perStudentDue.filter((d) => d.due > 0).length;
    const totalOutstanding = Math.max(totalDemand - totalCollected, 0);

    return {
      total_collection: round0(totalCollected),
      collection_percentage_of_demand:
        totalDemand > 0 ? round1((totalCollected / totalDemand) * 100) : null,
      outstanding_dues: round0(totalOutstanding),
      students_with_dues: studentsWithDues,
      scholarships: {
        total_value: scholarships.totalValue,
        beneficiaries: scholarships.beneficiaries,
        tracked: scholarships.tracked,
      },
      budget: {
        total_spent: round0(budget.totalSpent),
        total_sanctioned: budget.totalSanctioned,
        utilised_percentage: budget.utilisedPercentage,
      },
    };
  }

  private async perStudentDue(): Promise<
    { student_id: number; due: number }[]
  > {
    const mappings = await this.prisma.student_fee_demand_mapping.findMany({
      select: {
        student_id: true,
        total_amount: true,
        fee_payments: { select: { amount_paid: true } },
      },
    });
    const byStudent = new Map<number, number>();
    for (const m of mappings) {
      const collected = m.fee_payments.reduce(
        (s, p) => s + Number(p.amount_paid),
        0,
      );
      const due = Number(m.total_amount) - collected;
      byStudent.set(m.student_id, (byStudent.get(m.student_id) ?? 0) + due);
    }
    return Array.from(byStudent.entries()).map(([student_id, due]) => ({
      student_id,
      due,
    }));
  }

  /**
   * GET /me/principal/finance/collection-by-year
   *
   * Year of study derived from `students.class_id -> classes.current_semester`
   * (`year = ceil(semester / 2)`) — the real, populated progression field.
   * Students with no `class_id` (a handful) can't be placed in a year and
   * are bucketed separately rather than silently dropped or guessed.
   */
  async collectionByYear() {
    const mappings = await this.prisma.student_fee_demand_mapping.findMany({
      select: {
        total_amount: true,
        fee_payments: { select: { amount_paid: true } },
        students: {
          select: { classes: { select: { current_semester: true } } },
        },
      },
    });

    const byYear = new Map<number, { demand: number; collected: number }>();
    const unclassified = { demand: 0, collected: 0 };

    for (const m of mappings) {
      const sem = m.students.classes?.current_semester;
      const collected = m.fee_payments.reduce(
        (s, p) => s + Number(p.amount_paid),
        0,
      );
      const demand = Number(m.total_amount);
      if (sem == null) {
        unclassified.demand += demand;
        unclassified.collected += collected;
        continue;
      }
      const year = Math.ceil(sem / 2);
      const entry = byYear.get(year) ?? { demand: 0, collected: 0 };
      entry.demand += demand;
      entry.collected += collected;
      byYear.set(year, entry);
    }

    const yearLabels = [
      'First year',
      'Second year',
      'Third year',
      'Fourth year',
    ];
    const rows = [1, 2, 3, 4].map((year) => {
      const entry = byYear.get(year) ?? { demand: 0, collected: 0 };
      return {
        year: yearLabels[year - 1],
        demand: round0(entry.demand),
        collected: round0(entry.collected),
        pending: round0(entry.demand - entry.collected),
      };
    });
    if (unclassified.demand > 0) {
      rows.push({
        year: 'Unclassified (no class assigned)',
        demand: round0(unclassified.demand),
        collected: round0(unclassified.collected),
        pending: round0(unclassified.demand - unclassified.collected),
      });
    }
    return rows;
  }

  /**
   * GET /me/principal/finance/fee-heads
   *
   * `student_fee_demand_mapping.demand_category` is a real column but never
   * written by any create path in this codebase (confirmed dead) —
   * `fee_structure_items.demand_category_id` is the actual, populated
   * source. A demand mapping's flat `total_amount` is attributed across its
   * structure's category items proportionally to each item's amount (the
   * real, unambiguous split when a structure has exactly one item per
   * category, which is the common case); mappings whose structure has no
   * items at all bucket into "Unclassified".
   */
  async feeHeadBreakdown() {
    const [mappings, structureItems, payments, categories] = await Promise.all([
      this.prisma.student_fee_demand_mapping.findMany({
        select: { fee_structure_id: true, total_amount: true },
      }),
      this.prisma.fee_structure_items.findMany({
        select: {
          id: true,
          fee_structure_id: true,
          demand_category_id: true,
          amount: true,
        },
      }),
      this.prisma.fee_payments.findMany({
        select: { amount_paid: true, fee_structure_item_id: true },
      }),
      this.prisma.demand_categories.findMany({
        select: { id: true, name: true },
      }),
    ]);

    const itemsByStructure = new Map<number, typeof structureItems>();
    for (const item of structureItems) {
      const list = itemsByStructure.get(item.fee_structure_id) ?? [];
      list.push(item);
      itemsByStructure.set(item.fee_structure_id, list);
    }

    const demandByCategory = new Map<number | null, number>();
    for (const m of mappings) {
      const items = itemsByStructure.get(m.fee_structure_id) ?? [];
      if (items.length === 0) {
        demandByCategory.set(
          null,
          (demandByCategory.get(null) ?? 0) + Number(m.total_amount),
        );
        continue;
      }
      const itemSum = items.reduce((s, i) => s + Number(i.amount), 0);
      for (const item of items) {
        const share =
          itemSum > 0
            ? (Number(item.amount) / itemSum) * Number(m.total_amount)
            : Number(m.total_amount) / items.length;
        const key = item.demand_category_id;
        demandByCategory.set(key, (demandByCategory.get(key) ?? 0) + share);
      }
    }

    const itemById = new Map(structureItems.map((i) => [i.id, i]));
    const collectedByCategory = new Map<number | null, number>();
    for (const p of payments) {
      const item =
        p.fee_structure_item_id != null
          ? itemById.get(p.fee_structure_item_id)
          : undefined;
      const key = item?.demand_category_id ?? null;
      collectedByCategory.set(
        key,
        (collectedByCategory.get(key) ?? 0) + Number(p.amount_paid),
      );
    }

    const categoryNameById = new Map(categories.map((c) => [c.id, c.name]));
    const keys = new Set<number | null>([
      ...demandByCategory.keys(),
      ...collectedByCategory.keys(),
    ]);

    return Array.from(keys)
      .map((key) => {
        const demand = demandByCategory.get(key) ?? 0;
        const collected = collectedByCategory.get(key) ?? 0;
        return {
          fee_head:
            key != null
              ? (categoryNameById.get(key) ?? 'Unclassified')
              : 'Unclassified',
          demand: round0(demand),
          collected: round0(collected),
          balance: round0(demand - collected),
          recovery_percentage:
            demand > 0 ? round1((collected / demand) * 100) : null,
        };
      })
      .sort((a, b) => b.demand - a.demand);
  }

  /**
   * GET /me/principal/finance/dues-by-age
   *
   * No `due_date` exists anywhere in the fee schema — age is approximated
   * as days since `student_fee_demand_mapping.created_at` (when the demand
   * was raised), not true overdue days from an institutional due date,
   * since no such date is tracked. The ACTION column from the reference
   * design (Reminder SMS sent / Mentor follow-up / etc.) is not returned
   * here at all: it's descriptive mockup text with zero automation behind
   * it anywhere in this codebase, not a live field to fetch.
   */
  async duesByAge() {
    const today = startOfToday();
    const mappings = await this.prisma.student_fee_demand_mapping.findMany({
      select: {
        student_id: true,
        total_amount: true,
        created_at: true,
        fee_payments: { select: { amount_paid: true } },
      },
    });

    const buckets = [
      { label: '0-30 days', min: 0, max: 30 },
      { label: '31-60 days', min: 31, max: 60 },
      { label: '61-90 days', min: 61, max: 90 },
      { label: 'Above 90 days', min: 91, max: Infinity },
    ];
    const result = buckets.map((b) => ({
      age: b.label,
      students: new Set<number>(),
      amount: 0,
    }));

    for (const m of mappings) {
      const collected = m.fee_payments.reduce(
        (s, p) => s + Number(p.amount_paid),
        0,
      );
      const due = Number(m.total_amount) - collected;
      if (due <= 0) continue;
      const days = Math.floor(
        (today.getTime() - m.created_at.getTime()) / 86_400_000,
      );
      const bucketIndex = buckets.findIndex(
        (b) => days >= b.min && days <= b.max,
      );
      if (bucketIndex === -1) continue;
      result[bucketIndex].students.add(m.student_id);
      result[bucketIndex].amount += due;
    }

    return result.map((r) => ({
      age: r.age,
      students: r.students.size,
      amount: round0(r.amount),
    }));
  }

  /**
   * GET /me/principal/finance/scholarships
   *
   * `scholarship_schemes`/`student_scholarship_awards` (query.md #12) —
   * `fee_concessions` is structure-scoped with no scheme name/beneficiary/
   * status, so it can't back this table. Read via `$queryRaw`; `tracked`
   * distinguishes "table doesn't exist" from "table exists but no schemes
   * entered yet" so the frontend doesn't conflate the two.
   */
  async scholarships() {
    return this.tryLoadSchemesWithBeneficiaries();
  }

  private async tryLoadScholarships(): Promise<{
    tracked: boolean;
    totalValue: number;
    beneficiaries: number;
  }> {
    try {
      const awards = await this.prisma.$queryRaw<
        AwardRow[]
      >`SELECT scheme_id, amount FROM student_scholarship_awards`;
      return {
        tracked: true,
        totalValue: awards.reduce((sum, a) => sum + Number(a.amount), 0),
        beneficiaries: awards.length,
      };
    } catch {
      return { tracked: false, totalValue: 0, beneficiaries: 0 };
    }
  }

  private async tryLoadSchemesWithBeneficiaries() {
    try {
      const [schemesRows, awards] = await Promise.all([
        this.prisma.$queryRaw<
          SchemeRow[]
        >`SELECT id, name, academic_year, status FROM scholarship_schemes ORDER BY name ASC`,
        this.prisma.$queryRaw<
          AwardRow[]
        >`SELECT scheme_id, amount FROM student_scholarship_awards`,
      ]);
      const byScheme = new Map<number, { count: number; value: number }>();
      for (const a of awards) {
        const entry = byScheme.get(a.scheme_id) ?? { count: 0, value: 0 };
        entry.count += 1;
        entry.value += Number(a.amount);
        byScheme.set(a.scheme_id, entry);
      }
      return {
        tracked: true,
        schemes: schemesRows.map((s) => ({
          id: s.id,
          name: s.name,
          academic_year: s.academic_year,
          status: s.status,
          beneficiaries: byScheme.get(s.id)?.count ?? 0,
          value: round0(byScheme.get(s.id)?.value ?? 0),
        })),
      };
    } catch {
      return { tracked: false, schemes: [] as unknown[] };
    }
  }

  /**
   * GET /me/principal/finance/budget
   *
   * "Salaries and benefits" spend is real (`salary_payments`, status
   * processed, current calendar year). Sanctioned amounts come from
   * `budget_allocations` (query.md #12) via `$queryRaw` — `sanctioned` is
   * null per-head until a real figure is entered for that head/year, not
   * because the table is missing.
   */
  async budget() {
    const today = startOfToday();
    const [salaryAgg, allocations] = await Promise.all([
      this.prisma.salary_payments.aggregate({
        where: { status: 'processed', year: today.getUTCFullYear() },
        _sum: { net_amount: true },
      }),
      this.tryLoadBudgetAllocations(),
    ]);

    const salariesSpent = Number(salaryAgg._sum.net_amount ?? 0);
    const allocationByHead = new Map(
      allocations.map((a) => [a.head, Number(a.sanctioned_amount)]),
    );

    const heads = [
      {
        head: 'Salaries and benefits',
        spent: salariesSpent,
        sanctioned: allocationByHead.get('Salaries and benefits') ?? null,
      },
      ...Array.from(allocationByHead.entries())
        .filter(([head]) => head !== 'Salaries and benefits')
        .map(([head, sanctioned]) => ({
          head,
          spent: null as number | null,
          sanctioned,
        })),
    ];

    const totalSanctioned = heads.reduce(
      (sum, h) => sum + (h.sanctioned ?? 0),
      0,
    );
    const totalSpent = heads.reduce((sum, h) => sum + (h.spent ?? 0), 0);

    return {
      heads: heads.map((h) => ({
        head: h.head,
        spent: h.spent != null ? round0(h.spent) : null,
        sanctioned: h.sanctioned,
        share_of_spend:
          totalSpent > 0 && h.spent != null
            ? round1((h.spent / totalSpent) * 100)
            : null,
      })),
      totalSpent,
      totalSanctioned: totalSanctioned > 0 ? totalSanctioned : null,
      utilisedPercentage:
        totalSanctioned > 0
          ? round1((totalSpent / totalSanctioned) * 100)
          : null,
    };
  }

  private async tryLoadBudgetAllocations(): Promise<BudgetAllocationRow[]> {
    try {
      return await this.prisma.$queryRaw<BudgetAllocationRow[]>`
        SELECT head, sanctioned_amount FROM budget_allocations
      `;
    } catch {
      return [];
    }
  }
}
