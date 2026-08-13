import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { LibrarySettingsService } from 'src/modules/library/settings/settings.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { ListNoDueStudentsQueryDto } from './dto/list-no-due-students-query.dto';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date | string): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(later: Date | string, earlier: Date | string): number {
  return Math.round(
    (startOfDay(later).getTime() - startOfDay(earlier).getTime()) / MS_PER_DAY,
  );
}

interface StudentRow {
  id: number;
  student_id_no: string;
  roll_no: string | null;
  register_no: string | null;
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
  classes: { section: string } | null;
}

function resolveStudentName(student: StudentRow): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

/**
 * HoD-facing "No-Due Approval" — a per-student dues dashboard computed live
 * from real fee/library data (there is no stored "cleared/pending" column
 * anywhere in the schema). Fee categories are entirely data-driven from
 * whatever demand_categories rows actually exist for a student
 * (student_fee_demand_mapping) - nothing is hardcoded to a fixed
 * Tuition/Hostel/Transport/Lab list. The Library row reuses the exact same
 * live fine formula as the library module itself (days overdue/late ×
 * finePerDay, plus unsettled lost/damage charges) — see
 * borrow-records.service.ts's formatRecord() for the original.
 */
@Injectable()
export class NoDueService {
  private readonly logger = new Logger(NoDueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly librarySettings: LibrarySettingsService,
  ) {}

  /** GET /me/no-due/batches (HoD only) — batches with at least one class in the HoD's department. */
  async getBatches(userId: number) {
    const hod = await this.resolveFacultyByUserId(userId);

    const classRows = await this.prisma.classes.findMany({
      where: { department_id: hod.department_id },
      select: { batch_id: true },
      distinct: ['batch_id'],
    });
    const batchIds = classRows.map((c) => c.batch_id);
    if (batchIds.length === 0) return [];

    return this.prisma.batches.findMany({
      where: { id: { in: batchIds } },
      select: { id: true, name: true },
      orderBy: { start_year: 'desc' },
    });
  }

  /**
   * GET /me/no-due/students (HoD only).
   *
   * `override_approved` reflects an existing, currently-valid, approved
   * clearance_type='no_due' hall_ticket_clearance_exceptions row for that
   * student. It does NOT affect whether the student counts as cleared or
   * pending here (that stays tied to their real dues) - it only tells the
   * frontend to render "Approved" instead of "Approve" on an already
   *-overridden student, since real dues are the source of truth for the
   * Cleared/Pending split, per spec.
   *
   * Filtering by cleared/pending happens in application code, not SQL,
   * because "cleared" is a derived aggregate across two unrelated tables
   * (fees + library), not a column any query can filter on directly.
   * Department sizes here are small enough (one department's roster) that
   * this is not a concern.
   */
  async getStudents(query: ListNoDueStudentsQueryDto, userId: number) {
    const hod = await this.resolveFacultyByUserId(userId);
    const where: Record<string, unknown> = {
      classes: { department_id: hod.department_id },
    };
    if (query.batch_id !== undefined) {
      where.batch_id = query.batch_id;
    }
    return this.queryNoDueStudents(where, query);
  }

  /**
   * GET /me/mentee-no-due/batches (Faculty — class mentor). Same shape as
   * getBatches, scoped by class_mentors instead of department_id — the
   * class-advisor read-only equivalent of the HoD view. No approve action
   * is exposed to this role; the advisor can only view clearance status.
   */
  async getBatchesForMentor(userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mentorClasses = await this.prisma.class_mentors.findMany({
      where: { faculty_id: faculty.id },
      select: { class_id: true },
    });
    const classIds = mentorClasses.map((m) => m.class_id);
    if (classIds.length === 0) return [];

    const classRows = await this.prisma.classes.findMany({
      where: { id: { in: classIds } },
      select: { batch_id: true },
      distinct: ['batch_id'],
    });
    const batchIds = classRows.map((c) => c.batch_id);
    if (batchIds.length === 0) return [];

    return this.prisma.batches.findMany({
      where: { id: { in: batchIds } },
      select: { id: true, name: true },
      orderBy: { start_year: 'desc' },
    });
  }

  /**
   * GET /me/mentee-no-due/students (Faculty — class mentor). Same
   * fee/library dues computation as getStudents, scoped to the classes this
   * faculty mentors (via class_mentors) instead of a whole department.
   */
  async getStudentsForMentor(query: ListNoDueStudentsQueryDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mentorClasses = await this.prisma.class_mentors.findMany({
      where: { faculty_id: faculty.id },
      select: { class_id: true },
    });
    const classIds = mentorClasses.map((m) => m.class_id);
    if (classIds.length === 0) return paginate([], 0, query);

    const where: Record<string, unknown> = {
      classes: { id: { in: classIds } },
    };
    if (query.batch_id !== undefined) {
      where.batch_id = query.batch_id;
    }
    return this.queryNoDueStudents(where, query);
  }

  /** Shared dues computation for both the HoD and class-mentor views — only
   * the `where` scope (department vs. mentored classes) differs. */
  private async queryNoDueStudents(where: Record<string, unknown>, query: ListNoDueStudentsQueryDto) {
    const status = query.status ?? 'cleared';

    if (query.search) {
      where.OR = [
        { student_id_no: { contains: query.search, mode: 'insensitive' } },
        { register_no: { contains: query.search, mode: 'insensitive' } },
        { roll_no: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const students = await this.prisma.students.findMany({
      where,
      orderBy: { roll_no: 'asc' },
      select: {
        id: true,
        student_id_no: true,
        roll_no: true,
        register_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
        classes: { select: { section: true } },
      },
    });
    if (students.length === 0) {
      return paginate([], 0, query);
    }

    const studentIds = students.map((s) => s.id);

    const [demandRows, borrowRows, overrideRows, rules] = await Promise.all([
      // The per-category breakdown lives on fee_structures.fee_structure_items
      // (Tuition Fee / Examination Fee / Library Fee / ... - whatever items
      // the fee structure actually has), NOT on student_fee_demand_mapping
      // itself - that row's own `demand_category` column exists in the
      // schema but is unpopulated/null in real data; total_amount there is
      // the sum across every item in the structure, not a single category's
      // amount. fee_payments.fee_structure_item_id ties a payment to one
      // specific item when set; when it's null (a lump/unitemized payment)
      // it's applied against items in id order below (see the waterfall in
      // the aggregation loop) - the schema doesn't specify an allocation
      // order for unitemized payments, so this is a documented approximation.
      this.prisma.student_fee_demand_mapping.findMany({
        where: { student_id: { in: studentIds } },
        select: {
          student_id: true,
          fee_structures: {
            select: {
              fee_structure_items: {
                select: {
                  id: true,
                  amount: true,
                  demand_categories: { select: { name: true } },
                },
              },
            },
          },
          fee_payments: {
            select: { amount_paid: true, fee_structure_item_id: true },
          },
        },
      }),
      this.prisma.book_borrow_records.findMany({
        where: { student_id: { in: studentIds } },
        select: {
          student_id: true,
          status: true,
          due_date: true,
          returned_date: true,
          fine_paid: true,
          damage_lost_charge_amount: true,
          damage_lost_settled: true,
        },
      }),
      this.prisma.hall_ticket_clearance_exceptions.findMany({
        where: {
          student_id: { in: studentIds },
          clearance_type: 'no_due',
          status: 'approved',
        },
        select: { student_id: true, valid_until: true },
      }),
      this.librarySettings.getRules(),
    ]);

    const today = new Date();

    const feesByStudent = new Map<number, Map<string, number>>();
    for (const row of demandRows) {
      const items = row.fee_structures.fee_structure_items;
      if (items.length === 0) continue;

      const paidByItem = new Map<number, number>();
      let unallocatedPaid = 0;
      for (const p of row.fee_payments) {
        const amount = Number(p.amount_paid);
        if (p.fee_structure_item_id === null) {
          unallocatedPaid += amount;
        } else {
          paidByItem.set(
            p.fee_structure_item_id,
            (paidByItem.get(p.fee_structure_item_id) ?? 0) + amount,
          );
        }
      }

      const map = feesByStudent.get(row.student_id) ?? new Map<string, number>();
      for (const item of [...items].sort((a, b) => a.id - b.id)) {
        const category = item.demand_categories?.name ?? 'Other fees';
        let pending = Number(item.amount) - (paidByItem.get(item.id) ?? 0);
        if (pending > 0 && unallocatedPaid > 0) {
          const applied = Math.min(pending, unallocatedPaid);
          pending -= applied;
          unallocatedPaid -= applied;
        }
        pending = Math.max(0, pending);
        map.set(category, (map.get(category) ?? 0) + pending);
      }
      feesByStudent.set(row.student_id, map);
    }

    const libraryByStudent = new Map<number, number>();
    for (const row of borrowRows) {
      if (row.student_id === null) continue;

      let owed = 0;
      if (row.status === 'borrowed' && startOfDay(row.due_date) < startOfDay(today)) {
        owed = daysBetween(today, row.due_date) * rules.finePerDay;
      } else if (
        row.status === 'returned' &&
        row.returned_date &&
        !row.fine_paid &&
        startOfDay(row.returned_date) > startOfDay(row.due_date)
      ) {
        owed = daysBetween(row.returned_date, row.due_date) * rules.finePerDay;
      } else if (
        (row.status === 'lost' || row.status === 'damaged') &&
        !row.damage_lost_settled
      ) {
        owed =
          row.damage_lost_charge_amount !== null
            ? Number(row.damage_lost_charge_amount)
            : 0;
      }

      if (owed > 0) {
        libraryByStudent.set(row.student_id, (libraryByStudent.get(row.student_id) ?? 0) + owed);
      }
    }

    const overrideByStudent = new Set<number>();
    for (const row of overrideRows) {
      const stillValid = !row.valid_until || startOfDay(row.valid_until) >= startOfDay(today);
      if (stillValid) overrideByStudent.add(row.student_id);
    }

    const results = students.map((student) => {
      const feeMap = feesByStudent.get(student.id) ?? new Map<string, number>();
      const fees = [...feeMap.entries()].map(([category, pendingAmount]) => ({
        category,
        cleared: pendingAmount <= 0,
        pending_amount: pendingAmount,
      }));
      const libraryPending = libraryByStudent.get(student.id) ?? 0;
      const totalPending =
        fees.reduce((sum, f) => sum + f.pending_amount, 0) + libraryPending;

      return {
        id: student.id,
        name: resolveStudentName(student),
        student_id_no: student.student_id_no,
        roll_no: student.roll_no,
        register_no: student.register_no,
        section: student.classes?.section ?? null,
        fees,
        library: { cleared: libraryPending <= 0, pending_amount: libraryPending },
        total_pending: totalPending,
        override_approved: overrideByStudent.has(student.id),
      };
    });

    const filtered = results.filter((r) =>
      status === 'cleared' ? r.total_pending <= 0 : r.total_pending > 0,
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const pageRows = filtered.slice((page - 1) * limit, page * limit);

    return paginate(pageRows, filtered.length, query);
  }

  /**
   * POST /me/no-due/students/:student_id/approve (HoD only).
   *
   * HoD-initiated override — unlike the student-filed hall-ticket-clearance
   * flow (POST /hall-ticket-clearance), no prior request from the student is
   * required. Creates (or re-approves) a clearance_type='no_due'
   * hall_ticket_clearance_exceptions row tied to the most recent exam for
   * the student's own batch — exam_id is a required column on that table
   * and there's no exam-independent variant, so this is the closest fit for
   * a general "clear this student regardless of real dues" action. Never
   * touches fee_payments/student_fee_demand_mapping/book_borrow_records —
   * the student's real dues (and therefore their Cleared/Pending bucket
   * here) are completely untouched, exactly as intended.
   */
  async approveOverride(studentId: number, hodUserId: number) {
    const hod = await this.resolveFacultyByUserId(hodUserId);

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        batch_id: true,
        classes: { select: { department_id: true } },
      },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    if (student.classes?.department_id !== hod.department_id) {
      throw new ForbiddenException({
        message: 'You may only approve students in your own department',
        errorCode: 'DEPARTMENT_SCOPE_VIOLATION',
      });
    }

    const exam = await this.prisma.exams.findFirst({
      where: { batch_id: student.batch_id },
      orderBy: { created_at: 'desc' },
    });
    if (!exam) {
      throw new NotFoundException({
        message: "No exam found for this student's batch to attach the override to",
        errorCode: 'NO_EXAM_FOUND',
      });
    }

    const validUntil = new Date();
    validUntil.setFullYear(validUntil.getFullYear() + 1);

    const existing = await this.prisma.hall_ticket_clearance_exceptions.findUnique({
      where: {
        student_id_exam_id_clearance_type: {
          student_id: studentId,
          exam_id: exam.id,
          clearance_type: 'no_due',
        },
      },
    });

    if (existing) {
      await this.prisma.hall_ticket_clearance_exceptions.update({
        where: { id: existing.id },
        data: {
          status: 'approved',
          valid_until: validUntil,
          reviewed_by_hod_user_id: hodUserId,
          reviewed_at: new Date(),
        },
      });
    } else {
      await this.prisma.hall_ticket_clearance_exceptions.create({
        data: {
          student_id: studentId,
          exam_id: exam.id,
          clearance_type: 'no_due',
          status: 'approved',
          valid_until: validUntil,
          reviewed_by_hod_user_id: hodUserId,
          reviewed_at: new Date(),
        },
      });
    }

    this.logger.log(
      `No-due override approved: student=${studentId} by hod user=${hodUserId}`,
    );
    return { student_id: studentId, override_approved: true };
  }

  private async resolveFacultyByUserId(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }
}
