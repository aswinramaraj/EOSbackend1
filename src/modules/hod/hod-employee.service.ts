import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { FacultyAttendanceService } from '../faculty/faculty-attendance/faculty-attendance.service';
import { FacultyLeavesService } from '../faculty/faculty-leaves/faculty-leaves.service';
import { FacultyOdService } from '../faculty/faculty-od/faculty-od.service';
import { HrQueriesService } from '../faculty/hr-queries/hr-queries.service';
import { PayslipRequestsService } from '../faculty/payslip-requests/payslip-requests.service';
import { AppraisalService } from '../faculty/appraisal/appraisal.service';
import { LibrarySettingsService } from '../library/settings/settings.service';
import { CreateFacultyLeafDto } from '../faculty/faculty-leaves/dto/create-faculty-leaf.dto';
import { CreateFacultyOdDto } from '../faculty/faculty-od/dto/create-faculty-od.dto';
import { CreateHrQueryDto } from '../faculty/hr-queries/dto/create-hr-query.dto';
import { CreatePayslipRequestDto } from '../faculty/payslip-requests/dto/create-payslip-request.dto';
import { CreateAppraisalDto } from '../faculty/appraisal/dto/create-appraisal.dto';

function overallStatus(
  hod: string,
  hr: string,
): 'pending' | 'approved' | 'rejected' {
  if (hod === 'rejected' || hr === 'rejected') return 'rejected';
  if (hod === 'approved' && hr === 'approved') return 'approved';
  return 'pending';
}

const DAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];
/** Mon-Sat, matching every other timetable view in this codebase (see hod-timetable.service.ts's own TEACHING_DAYS). */
const TEACHING_DAYS = [1, 2, 3, 4, 5, 6];

function formatHHMM(time: Date): string {
  return time.toISOString().slice(11, 16);
}
function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function yearLabel(semester: number | null): string {
  if (semester == null) return '—';
  return ['I', 'II', 'III', 'IV'][Math.ceil(semester / 2) - 1] ?? '—';
}
/** Monday (UTC, date-only) of the week containing the given ISO date. */
function mondayOf(dateStr: string): Date {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? 1 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

/**
 * "Employee" self-service for the HOD's OWN record (a HOD is also faculty).
 * Every method here either (a) delegates wholesale to a real, already-
 * working faculty self-service method — never re-deriving its business
 * rules — or (b) runs its own direct, real-table query ONLY where the
 * existing service forces department-wide scope for a HOD caller instead of
 * "my own record" (faculty-leaves/faculty-od/appraisal's own findAll all do
 * this — confirmed by reading each). Every query sequential, no
 * Promise.all across DB calls — Supabase's session pool caps at 15.
 *
 * Library is VIEW-only for the same real-world reason Secretary's own
 * equivalent route (`me/library/staff-borrow-records`) is view-only too
 * (see that controller's own comment): real books can only be checked out,
 * renewed and returned by library staff at the desk. Overdue/fine
 * calculation below mirrors NoDueService's exact formula
 * (days-late * LibrarySettingsService.getRules().finePerDay) rather than
 * re-deriving it. `card_no` has no real column anywhere in the schema — a
 * physical library-card-number concept doesn't exist here — so it's a
 * clearly-derived `EMP-{facultyId}` label, not a fabricated number.
 *
 * One feature has NO real backend anywhere in this schema and is
 * deliberately NOT implemented here rather than fabricated: generic
 * employee venue booking (the only real venue-booking table/controller is
 * Principal-only, under /me/principal/facilities/venue-bookings).
 */
@Injectable()
export class HodEmployeeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facultyAttendance: FacultyAttendanceService,
    private readonly facultyLeaves: FacultyLeavesService,
    private readonly facultyOd: FacultyOdService,
    private readonly hrQueries: HrQueriesService,
    private readonly payslipRequests: PayslipRequestsService,
    private readonly appraisal: AppraisalService,
    private readonly librarySettings: LibrarySettingsService,
  ) {}

  private async resolveFaculty(user: JwtPayload) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        designation: true,
      },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty;
  }

  async getMyAttendance(user: JwtPayload, academicYear?: string) {
    const faculty = await this.resolveFaculty(user);
    const result = await this.facultyAttendance.getForFaculty(
      faculty.id,
      academicYear,
    );
    const recentPunches =
      result.months.length > 0 ? result.months[0].days.slice(0, 10) : [];
    return {
      faculty: {
        id: faculty.id,
        name: `${faculty.first_name} ${faculty.last_name}`.trim(),
        designation: faculty.designation,
      },
      overall: result.overall,
      months: result.months,
      recent_punches: recentPunches,
    };
  }

  /** Real `timetable_slots` rows for this faculty across the whole week
   * containing `date` — shared base query for both the day and week views
   * below, so "today" and "full week" never disagree with each other. */
  private async getMyWeekSlots(facultyId: number) {
    return this.prisma.timetable_slots.findMany({
      where: { faculty_id: facultyId },
      orderBy: [{ day_of_week: 'asc' }, { period_number: 'asc' }],
      select: {
        id: true,
        day_of_week: true,
        period_number: true,
        start_time: true,
        end_time: true,
        subjects: {
          select: { name: true, subject_code: true, course_type: true },
        },
        classes: { select: { section: true, current_semester: true } },
        venues: { select: { name: true } },
      },
    });
  }

  async getTimetableDay(user: JwtPayload, dateStr?: string) {
    const faculty = await this.resolveFaculty(user);
    const target = dateStr ? new Date(`${dateStr}T00:00:00Z`) : new Date();
    const monday = mondayOf(toDateOnly(target));
    const targetIso = toDateOnly(target);

    const weekDates = TEACHING_DAYS.map((_, i) => {
      const d = new Date(monday);
      d.setUTCDate(d.getUTCDate() + i);
      const iso = toDateOnly(d);
      return {
        date: iso,
        day_label: DAY_LABELS[d.getUTCDay()].slice(0, 3),
        day_number: d.getUTCDate(),
        is_selected: iso === targetIso,
      };
    });

    const dayOfWeek = target.getUTCDay();
    const slots = await this.getMyWeekSlots(faculty.id);
    const dayPeriods = slots.filter((s) => s.day_of_week === dayOfWeek);
    const labs = dayPeriods.filter((p) =>
      p.subjects.course_type?.includes('PRACTICAL'),
    ).length;

    return {
      faculty: {
        name: `${faculty.first_name} ${faculty.last_name}`.trim(),
        department_code: null,
        office_room: null,
      },
      date: targetIso,
      day_label: DAY_LABELS[dayOfWeek],
      week_dates: weekDates,
      stats: {
        classes: dayPeriods.length,
        labs,
        free_hours: null,
        total_hours: dayPeriods.length,
      },
      periods: dayPeriods.map((s) => ({
        id: s.id,
        period_number: s.period_number,
        start_time: formatHHMM(s.start_time),
        end_time: formatHHMM(s.end_time),
        minutes: null,
        subject_name: s.subjects.name,
        subject_code: s.subjects.subject_code,
        class_label: `${yearLabel(s.classes.current_semester)}-${s.classes.section}`,
        venue_name: s.venues?.name ?? null,
        type: s.subjects.course_type?.includes('PRACTICAL') ? 'lab' : 'class',
      })),
    };
  }

  /**
   * GET /hod/employee/timetable/week — same real `timetable_slots` data as
   * the day view, reshaped into a Mon-Sat grid. Columns come from the
   * institution-wide period template (every distinct day_of_week+period
   * combo that exists anywhere in timetable_slots, not just this faculty's
   * own) — same real-data-driven technique TimetableService.getFullWeekForFacultyId
   * already uses for this exact problem elsewhere, kept as its own local
   * query here rather than reusing that shared method since this view needs
   * fields (id, venue, lab/class kind) that method's roster-only select
   * doesn't carry, and roster callers elsewhere shouldn't be affected by
   * widening it. A period nobody in the department has that day+period is
   * "break" (real absence relative to the department's actual schedule,
   * not fabricated); a period the department runs but this faculty has
   * nothing scheduled is "free".
   */
  async getTimetableWeek(user: JwtPayload, dateStr?: string) {
    const faculty = await this.resolveFaculty(user);
    const monday = mondayOf(dateStr ?? toDateOnly(new Date()));

    const template = await this.prisma.timetable_slots.findMany({
      distinct: ['day_of_week', 'period_number'],
      orderBy: [{ day_of_week: 'asc' }, { period_number: 'asc' }],
      select: {
        day_of_week: true,
        period_number: true,
        start_time: true,
        end_time: true,
      },
    });
    const slots = await this.getMyWeekSlots(faculty.id);

    const columnMap = new Map<
      number,
      { start_time: string; end_time: string }
    >();
    for (const t of template) {
      if (!columnMap.has(t.period_number)) {
        columnMap.set(t.period_number, {
          start_time: formatHHMM(t.start_time),
          end_time: formatHHMM(t.end_time),
        });
      }
    }
    const columns = [...columnMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([period_number, times]) => ({ period_number, ...times }));

    const templatePeriodsByDay = new Map<number, Set<number>>();
    for (const t of template) {
      const set = templatePeriodsByDay.get(t.day_of_week) ?? new Set<number>();
      set.add(t.period_number);
      templatePeriodsByDay.set(t.day_of_week, set);
    }
    const mySlotByDayPeriod = new Map(
      slots.map((s) => [`${s.day_of_week}-${s.period_number}`, s]),
    );

    const rows = TEACHING_DAYS.map((day, i) => {
      const d = new Date(monday);
      d.setUTCDate(d.getUTCDate() + i);
      const runsThatDay = templatePeriodsByDay.get(day) ?? new Set<number>();
      let classes = 0;
      let labs = 0;
      const cells = columns.map((col) => {
        const s = mySlotByDayPeriod.get(`${day}-${col.period_number}`);
        if (!s) {
          return {
            type: runsThatDay.has(col.period_number) ? 'free' : 'break',
          };
        }
        const isLab = Boolean(s.subjects.course_type?.includes('PRACTICAL'));
        if (isLab) labs++;
        else classes++;
        return {
          id: s.id,
          period_number: col.period_number,
          start_time: formatHHMM(s.start_time),
          end_time: formatHHMM(s.end_time),
          minutes: null,
          subject_name: s.subjects.name,
          subject_code: s.subjects.subject_code,
          class_label: `${yearLabel(s.classes.current_semester)}-${s.classes.section}`,
          venue_name: s.venues?.name ?? null,
          type: isLab ? 'lab' : 'class',
        };
      });
      return {
        date: toDateOnly(d),
        day_label: DAY_LABELS[day],
        stats: {
          classes,
          labs,
          free_hours: null,
          total_hours: classes + labs,
        },
        cells,
      };
    });

    return {
      faculty: {
        name: `${faculty.first_name} ${faculty.last_name}`.trim(),
        department_code: null,
        office_room: null,
      },
      columns,
      rows,
    };
  }

  async getLeaveTypes() {
    return this.prisma.leave_types.findMany({
      where: { is_active: true },
      select: { id: true, name: true, default_annual_quota: true },
      orderBy: { name: 'asc' },
    });
  }

  async getLeaveBalances(user: JwtPayload, academicYear?: string) {
    const faculty = await this.resolveFaculty(user);
    const rows = await this.prisma.faculty_leave_balances.findMany({
      where: {
        faculty_id: faculty.id,
        academic_year: academicYear,
      },
      select: {
        leave_type_id: true,
        allocated: true,
        used: true,
        leave_types: { select: { name: true } },
      },
      orderBy: { leave_type_id: 'asc' },
    });
    return rows.map((r) => ({
      leave_type_id: r.leave_type_id,
      leave_type: r.leave_types.name,
      allocated: r.allocated,
      used: r.used,
      remaining: r.allocated - r.used,
    }));
  }

  async getLeaveHistory(
    user: JwtPayload,
    status?: 'pending' | 'approved' | 'rejected',
  ) {
    const faculty = await this.resolveFaculty(user);
    const rows = await this.prisma.faculty_leaves.findMany({
      where: { faculty_id: faculty.id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        from_date: true,
        to_date: true,
        reason: true,
        hod_approval_status: true,
        hr_approval_status: true,
        created_at: true,
        leave_types: { select: { id: true, name: true } },
      },
    });
    return rows
      .map((r) => ({
        id: r.id,
        from_date: r.from_date.toISOString().slice(0, 10),
        to_date: r.to_date.toISOString().slice(0, 10),
        reason: r.reason,
        leave_type: r.leave_types,
        hod_approval_status: r.hod_approval_status,
        hr_approval_status: r.hr_approval_status,
        overall_status: overallStatus(
          r.hod_approval_status,
          r.hr_approval_status,
        ),
        created_at: r.created_at.toISOString(),
      }))
      .filter((r) => !status || r.overall_status === status);
  }

  applyLeave(user: JwtPayload, dto: CreateFacultyLeafDto) {
    return this.facultyLeaves.create(dto, user);
  }

  async getOdHistory(
    user: JwtPayload,
    status?: 'pending' | 'approved' | 'rejected',
  ) {
    const faculty = await this.resolveFaculty(user);
    const rows = await this.prisma.faculty_od_requests.findMany({
      where: { faculty_id: faculty.id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        from_date: true,
        to_date: true,
        place: true,
        purpose: true,
        organization_visited: true,
        hod_approval_status: true,
        hr_approval_status: true,
        created_at: true,
      },
    });
    return rows
      .map((r) => ({
        id: r.id,
        from_date: r.from_date.toISOString().slice(0, 10),
        to_date: r.to_date.toISOString().slice(0, 10),
        place: r.place,
        purpose: r.purpose,
        organization_visited: r.organization_visited,
        // No real od_type/periods_affected/class_adjustment columns exist
        // on faculty_od_requests — honest null, not fabricated.
        od_type: null,
        periods_affected: null,
        class_adjustment: null,
        hod_approval_status: r.hod_approval_status,
        hr_approval_status: r.hr_approval_status,
        overall_status: overallStatus(
          r.hod_approval_status,
          r.hr_approval_status,
        ),
        created_at: r.created_at.toISOString(),
      }))
      .filter((r) => !status || r.overall_status === status);
  }

  applyOd(user: JwtPayload, dto: CreateFacultyOdDto) {
    return this.facultyOd.create(dto, user);
  }

  getHrPayrollRequests(user: JwtPayload) {
    return this.hrQueries.findMine(user.sub);
  }

  createHrPayrollRequest(user: JwtPayload, dto: CreateHrQueryDto) {
    return this.hrQueries.create(dto, user.sub, undefined);
  }

  async getPayslipHistory(user: JwtPayload) {
    const faculty = await this.resolveFaculty(user);
    const rows = await this.prisma.payslip_requests.findMany({
      where: { faculty_id: faculty.id },
      orderBy: { requested_at: 'desc' },
      select: {
        id: true,
        month: true,
        year: true,
        status: true,
        file_url: true,
        requested_at: true,
        purpose: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      month: `${r.year}-${String(r.month).padStart(2, '0')}`,
      status: r.status,
      file_url: r.file_url,
      requested_at: r.requested_at.toISOString(),
      purpose: r.purpose,
    }));
  }

  applyPayslip(user: JwtPayload, dto: CreatePayslipRequestDto) {
    return this.payslipRequests.create(dto, user.sub);
  }

  getAppraisalCriteria() {
    return this.appraisal.findCriteria({});
  }

  async getAppraisalHistory(user: JwtPayload) {
    const faculty = await this.resolveFaculty(user);
    const rows = await this.prisma.appraisal_requests.findMany({
      where: { faculty_id: faculty.id },
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        academic_year: true,
        status: true,
        hod_reviewed_at: true,
        management_approved_at: true,
        created_at: true,
        appraisal_entries: {
          select: {
            id: true,
            description: true,
            score: true,
            appraisal_criteria: {
              select: {
                id: true,
                criteria_name: true,
                max_score: true,
                appraisal_divisions: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      academic_year: r.academic_year,
      status: r.status,
      hod_reviewed_at: r.hod_reviewed_at?.toISOString() ?? null,
      management_approved_at: r.management_approved_at?.toISOString() ?? null,
      created_at: r.created_at.toISOString(),
      entries: r.appraisal_entries.map((e) => ({
        id: e.id,
        description: e.description,
        score: e.score,
        criteria: {
          id: e.appraisal_criteria.id,
          name: e.appraisal_criteria.criteria_name,
          max_score: e.appraisal_criteria.max_score,
          division: e.appraisal_criteria.appraisal_divisions,
        },
      })),
    }));
  }

  applyAppraisal(user: JwtPayload, dto: CreateAppraisalDto) {
    return this.appraisal.create(dto, user);
  }

  async getLibraryOverview(user: JwtPayload) {
    const faculty = await this.resolveFaculty(user);
    const rules = await this.librarySettings.getRules();

    const records = await this.prisma.book_borrow_records.findMany({
      where: { staff_user_id: user.sub },
      include: {
        books: {
          select: { id: true, title: true, qr_code: true, author: true },
        },
      },
      orderBy: { borrowed_date: 'desc' },
    });

    const today = new Date();
    const startOfDay = (d: Date) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const daysBetween = (later: Date, earlier: Date) =>
      Math.round(
        (startOfDay(later).getTime() - startOfDay(earlier).getTime()) /
          86_400_000,
      );

    // Same overdue/late-fine formula as NoDueService (days late * finePerDay) — not re-derived, just applied to this staff member's own records.
    const toRow = (r: (typeof records)[number]) => {
      const isBorrowed = r.status === 'borrowed' || r.status === 'overdue';
      const isOverdue =
        isBorrowed && startOfDay(r.due_date) < startOfDay(today);
      const daysOverdue = isOverdue ? daysBetween(today, r.due_date) : 0;
      const returnedLate =
        r.status === 'returned' &&
        r.returned_date != null &&
        startOfDay(r.returned_date) > startOfDay(r.due_date);
      const daysLate = returnedLate
        ? daysBetween(r.returned_date!, r.due_date)
        : 0;
      const fineAmount =
        (isOverdue ? daysOverdue : daysLate) * rules.finePerDay;

      return {
        id: r.id,
        book: {
          id: r.books.id,
          title: r.books.title,
          qr_code: r.books.qr_code,
          author: r.books.author,
        },
        borrowed_date: r.borrowed_date.toISOString(),
        due_date: r.due_date.toISOString(),
        returned_date: r.returned_date?.toISOString() ?? null,
        status: r.status === 'overdue' ? 'borrowed' : r.status,
        renewal_count: r.renewal_count,
        last_renewed_at: r.last_renewed_at?.toISOString() ?? null,
        is_overdue: isOverdue,
        days_overdue: daysOverdue,
        returned_late: returnedLate,
        days_late: daysLate,
        fine_amount: fineAmount,
      };
    };

    const rows = records.map(toRow);

    return {
      // No library-card-number concept exists anywhere in this schema —
      // a clearly-derived staff identifier, not a fabricated card number.
      card_no: `EMP-${faculty.id}`,
      books_per_student: rules.booksPerStudent,
      max_renewals: rules.maxRenewals,
      borrowed: rows.filter((r) => r.status === 'borrowed'),
      history: rows.filter((r) => r.status !== 'borrowed'),
    };
  }
}
