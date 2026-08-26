import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { PrincipalDashboardService } from '../dashboard/dashboard.service';
import { ListPrincipalFacultyQueryDto } from './dto/list-principal-faculty-query.dto';

/** Same Odd/Even semester convention as PrincipalDashboardService's private getPeriodRange('term', ...) — duplicated (see students/students.service.ts's currentTermRange for the same tradeoff). Safe here because attendance_date is a real Date column, not one of this schema's inconsistently-formatted academic_year strings. */
function currentTermRange(today: Date): { start: Date; end: Date } {
  const calendarYear = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  if (month >= 7) {
    return {
      start: new Date(Date.UTC(calendarYear, 6, 1)),
      end: new Date(Date.UTC(calendarYear, 11, 31)),
    };
  }
  return {
    start: new Date(Date.UTC(calendarYear, 0, 1)),
    end: new Date(Date.UTC(calendarYear, 5, 30)),
  };
}

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

/**
 * `academic_year` is stored as free-text VARCHAR across faculty_daily_attendance
 * and faculty_subject_class_mapping, and real live rows use BOTH "2025-2026"
 * and "2025-26" for the same year inconsistently — a single equality filter
 * silently misses rows. Every lookup keyed by "the current academic year"
 * matches against both real formats instead of picking one.
 */
function currentAcademicYearCandidates(today: Date): string[] {
  const calendarYear = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const start = month >= 6 ? calendarYear : calendarYear - 1;
  const end = start + 1;
  return [`${start}-${end}`, `${start}-${String(end).slice(-2)}`];
}

const DEFAULT_PAGE_SIZE = 15;

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

@Injectable()
export class PrincipalFacultyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dashboard: PrincipalDashboardService,
  ) {}

  /** GET /me/principal/faculty/filters — real departments only, no hardcoded list. */
  async filters() {
    const departments = await this.prisma.departments.findMany({
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
    return { departments };
  }

  /**
   * GET /me/principal/faculty/summary
   *
   * "On duty today" reuses PrincipalDashboardService.summary().faculty — the
   * same figure already shown on the Principal dashboard, rather than a
   * second, differently-derived "on duty" number that could disagree with
   * it. Leave requests / appraisals / payroll are all backed by real tables
   * with real data (unlike Students' CGPA, none of these four tiles are a
   * genuine gap) — see PrincipalFacultyModule's investigation notes.
   */
  async summary() {
    const today = startOfToday();
    const [dashboardStats, leaveRequestsPending, appraisals, payroll] =
      await Promise.all([
        this.dashboard.summary(),
        this.pendingLeaveAndOdCount(),
        this.appraisalCounts(),
        this.payrollThisMonth(today),
      ]);

    return {
      teaching_total: dashboardStats.faculty.total_active,
      non_teaching_total: dashboardStats.non_teaching_staff.total_active,
      on_duty: {
        reported_today: dashboardStats.faculty.reported_today,
        on_leave_today: dashboardStats.faculty.on_leave_today,
        total_active: dashboardStats.faculty.total_active,
      },
      leave_requests_pending: leaveRequestsPending,
      appraisals,
      payroll,
    };
  }

  /** Pending at either approval stage — same OR-across-both-columns pattern HrDashboardService.getSummary() uses. */
  private async pendingLeaveAndOdCount() {
    const [pendingLeaves, pendingOd] = await Promise.all([
      this.prisma.faculty_leaves.count({
        where: {
          OR: [
            { hod_approval_status: 'pending' },
            { hr_approval_status: 'pending' },
          ],
        },
      }),
      this.prisma.faculty_od_requests.count({
        where: {
          OR: [
            { hod_approval_status: 'pending' },
            { hr_approval_status: 'pending' },
          ],
        },
      }),
    ]);
    return pendingLeaves + pendingOd;
  }

  /** All-time, not scoped to one academic_year: appraisal cycles don't line up with the Odd/Even term convention, and this table has the same free-text academic_year inconsistency as the attendance/mapping tables. */
  private async appraisalCounts() {
    const rows = await this.prisma.appraisal_requests.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const total = rows.reduce((sum, r) => sum + r._count._all, 0);
    const closed =
      rows.find((r) => r.status === 'management_approved')?._count._all ?? 0;
    return { closed, total };
  }

  /** Real calendar month/year — salary_payments.status is a real column (management_approved-style enum), not the stale paid_at-proxy HrDashboardService's own comment describes. */
  private async payrollThisMonth(today: Date) {
    const month = today.getUTCMonth() + 1;
    const year = today.getUTCFullYear();
    const rows = await this.prisma.salary_payments.findMany({
      where: { month, year },
      select: { status: true, net_amount: true },
    });
    const processedRows = rows.filter((r) => r.status === 'processed');
    return {
      month_label: MONTH_NAMES[month - 1],
      processed_count: processedRows.length,
      total_count: rows.length,
      processed_amount: Math.round(
        processedRows.reduce((sum, r) => sum + Number(r.net_amount), 0),
      ),
    };
  }

  /**
   * GET /me/principal/faculty
   *
   * Only 18 real faculty exist in this environment, so — same tradeoff as
   * the Students list — this fetches every matching row and computes
   * classes/attendance/publications for exactly that set, then sorts
   * department-wise (department name/code ascending, then faculty name)
   * and paginates in memory rather than at the SQL level.
   */
  async list(query: ListPrincipalFacultyQueryDto) {
    const where: NonNullable<
      Parameters<typeof this.prisma.faculty.findMany>[0]
    >['where'] = {};
    if (!query.status || query.status === 'active') where.status = 'active';
    else if (query.status === 'inactive') where.status = 'inactive';
    if (query.department_id) where.department_id = query.department_id;
    if (query.q) {
      const q = query.q;
      where.OR = [
        { first_name: { contains: q, mode: 'insensitive' } },
        { last_name: { contains: q, mode: 'insensitive' } },
        { designation: { contains: q, mode: 'insensitive' } },
        { users: { email: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const rows = await this.prisma.faculty.findMany({
      where,
      orderBy: { id: 'desc' },
      select: {
        id: true,
        prefix: true,
        first_name: true,
        last_name: true,
        designation: true,
        qualification: true,
        date_of_joining: true,
        previous_experience_years: true,
        status: true,
        staff_code: true,
        departments: { select: { id: true, name: true, code: true } },
        users: { select: { email: true, phone: true } },
      },
    });

    const ids = rows.map((r) => r.id);
    const [classesByFaculty, attendanceByFaculty, publicationsByFaculty] =
      await Promise.all([
        this.classesTaughtByFaculty(ids),
        this.attendanceByFaculty(ids),
        this.publicationsByFaculty(ids),
      ]);

    let faculty = rows.map((row) => ({
      id: row.id,
      name: [row.prefix, row.first_name, row.last_name]
        .filter(Boolean)
        .join(' '),
      designation: row.designation,
      staff_code: row.staff_code,
      department: row.departments,
      qualification: row.qualification,
      // "Ph.D"/"Ph.D." are the only real values that indicate a doctorate —
      // confirmed against the actual distinct qualification strings on file.
      has_doctorate: (row.qualification ?? '').toLowerCase().includes('ph.d'),
      experience_years: this.experienceYears(
        row.date_of_joining,
        row.previous_experience_years,
      ),
      classes_count: classesByFaculty.get(row.id) ?? 0,
      attendance_percentage: attendanceByFaculty.get(row.id) ?? null,
      publications_count: publicationsByFaculty.get(row.id) ?? 0,
      status: row.status,
      email: row.users.email,
      phone: row.users.phone,
    }));

    // Department-wise register order: department name ascending, then
    // faculty name within it — matches how a paper staff register is
    // actually filed, not an arbitrary id sort.
    faculty = faculty.sort((a, b) => {
      const deptA = a.department?.name ?? '';
      const deptB = b.department?.name ?? '';
      if (deptA !== deptB) return deptA.localeCompare(deptB);
      return a.name.localeCompare(b.name);
    });

    const total = faculty.length;
    const limit = query.limit ?? DEFAULT_PAGE_SIZE;
    const page = query.page ?? 1;
    const offset = (page - 1) * limit;
    const pageFaculty = faculty.slice(offset, offset + limit);

    return {
      total,
      page,
      limit,
      total_pages: Math.max(Math.ceil(total / limit), 1),
      faculty: pageFaculty,
    };
  }

  /** Tenure since date_of_joining, plus any prior-institution experience on file. Null when date_of_joining is unset — there is no stored total-experience figure to fall back on. */
  private experienceYears(
    dateOfJoining: Date | null,
    previousExperienceYears: number | null,
  ): number | null {
    if (!dateOfJoining) return null;
    const tenureYears =
      (Date.now() - dateOfJoining.getTime()) / (365.25 * 24 * 3600 * 1000);
    return Math.round((tenureYears + (previousExperienceYears ?? 0)) * 10) / 10;
  }

  /** Distinct classes taught this academic year, from faculty_subject_class_mapping — the clean source for "what does this faculty teach", not timetable_slots. */
  private async classesTaughtByFaculty(
    facultyIds: number[],
  ): Promise<Map<number, number>> {
    if (facultyIds.length === 0) return new Map();
    const candidates = currentAcademicYearCandidates(startOfToday());
    const rows = await this.prisma.faculty_subject_class_mapping.findMany({
      where: {
        faculty_id: { in: facultyIds },
        academic_year: { in: candidates },
      },
      select: { faculty_id: true, class_id: true },
      distinct: ['faculty_id', 'class_id'],
    });
    const result = new Map<number, number>();
    for (const r of rows) {
      result.set(r.faculty_id, (result.get(r.faculty_id) ?? 0) + 1);
    }
    return result;
  }

  /**
   * Attendance % this term — full_day counts as 1, half_day as 0.5; the
   * denominator only counts days the faculty member was expected on campus
   * (full_day/half_day/absent), excluding on_leave/weekly_off/holiday, since
   * those aren't attendance obligations to measure against.
   */
  private async attendanceByFaculty(
    facultyIds: number[],
  ): Promise<Map<number, number>> {
    if (facultyIds.length === 0) return new Map();
    const { start, end } = currentTermRange(startOfToday());
    const records = await this.prisma.faculty_daily_attendance.findMany({
      where: {
        faculty_id: { in: facultyIds },
        attendance_date: { gte: start, lte: end },
        status: { in: ['full_day', 'half_day', 'absent'] },
      },
      select: { faculty_id: true, status: true },
    });

    const byFaculty = new Map<number, { earned: number; total: number }>();
    for (const r of records) {
      // Non-null assertion justified: the where clause above
      // (faculty_id: { in: facultyIds }) guarantees every row here has a
      // real faculty_id — faculty_id is only nullable at the schema level
      // for the unrelated Secretary staff_user_id rows this query never
      // selects.
      const facultyId = r.faculty_id!;
      const entry = byFaculty.get(facultyId) ?? { earned: 0, total: 0 };
      entry.total += 1;
      if (r.status === 'full_day') entry.earned += 1;
      else if (r.status === 'half_day') entry.earned += 0.5;
      byFaculty.set(facultyId, entry);
    }

    const result = new Map<number, number>();
    for (const [facultyId, entry] of byFaculty.entries()) {
      if (entry.total > 0) {
        result.set(
          facultyId,
          Math.round((entry.earned / entry.total) * 1000) / 10,
        );
      }
    }
    return result;
  }

  /** All-time publication count per faculty, from the real (currently sparsely-populated) faculty_publications table. */
  private async publicationsByFaculty(
    facultyIds: number[],
  ): Promise<Map<number, number>> {
    if (facultyIds.length === 0) return new Map();
    const rows = await this.prisma.faculty_publications.groupBy({
      by: ['faculty_id'],
      where: { faculty_id: { in: facultyIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.faculty_id, r._count._all]));
  }

  /**
   * GET /me/principal/faculty/department-strength
   *
   * TEACHING/SUPPORT headcounts, average weekly workload hours (from
   * timetable_slots, same computation PrincipalDashboardService.
   * facultyWorkloadFlags() uses — deliberately not academic_year-filtered,
   * matching that existing convention, since timetable_slots carries the
   * same free-text academic_year inconsistency documented above), and mean
   * this-term attendance %.
   */
  async departmentStrength() {
    const [departments, teachingRows, supportRows, slots, attendanceRows] =
      await Promise.all([
        this.prisma.departments.findMany({
          select: { id: true, name: true, code: true },
        }),
        this.prisma.faculty.findMany({
          where: { status: 'active' },
          select: { id: true, department_id: true },
        }),
        this.prisma.non_teaching_staff.findMany({
          where: { status: 'active' },
          select: { department_id: true },
        }),
        this.prisma.timetable_slots.findMany({
          select: {
            faculty_id: true,
            start_time: true,
            end_time: true,
            faculty: { select: { department_id: true } },
          },
        }),
        this.attendanceByFaculty(
          (
            await this.prisma.faculty.findMany({
              where: { status: 'active' },
              select: { id: true },
            })
          ).map((f) => f.id),
        ),
      ]);

    const teachingByDept = new Map<number, number[]>();
    for (const f of teachingRows) {
      const list = teachingByDept.get(f.department_id) ?? [];
      list.push(f.id);
      teachingByDept.set(f.department_id, list);
    }

    const supportByDept = new Map<number, number>();
    let supportUnassigned = 0;
    for (const s of supportRows) {
      if (s.department_id == null) {
        supportUnassigned += 1;
        continue;
      }
      supportByDept.set(
        s.department_id,
        (supportByDept.get(s.department_id) ?? 0) + 1,
      );
    }

    const hoursByFaculty = new Map<number, number>();
    for (const s of slots) {
      const hours = (s.end_time.getTime() - s.start_time.getTime()) / 3_600_000;
      hoursByFaculty.set(
        s.faculty_id,
        (hoursByFaculty.get(s.faculty_id) ?? 0) + hours,
      );
    }

    const rows = departments.map((dept) => {
      const facultyIds = teachingByDept.get(dept.id) ?? [];
      const teaching = facultyIds.length;
      const totalHours = facultyIds.reduce(
        (sum, id) => sum + (hoursByFaculty.get(id) ?? 0),
        0,
      );
      const attendancePcts = facultyIds
        .map((id) => attendanceRows.get(id))
        .filter((v): v is number => v != null);

      return {
        department: { id: dept.id, name: dept.name, code: dept.code },
        teaching,
        support: supportByDept.get(dept.id) ?? 0,
        avg_workload_hours:
          teaching > 0 ? Math.round((totalHours / teaching) * 10) / 10 : null,
        attendance_percentage:
          attendancePcts.length > 0
            ? Math.round(
                (attendancePcts.reduce((a, b) => a + b, 0) /
                  attendancePcts.length) *
                  10,
              ) / 10
            : null,
      };
    });

    return { departments: rows, support_unassigned: supportUnassigned };
  }

  /**
   * GET /me/principal/faculty/publications/venues
   *
   * Venue-wise leading entries, matching the reference design's
   * JOURNAL/VENUE · PAPERS · CITATIONS table. No "INDEXING" column: this
   * schema's faculty_publications has no indexing field (Scopus/SCIE/etc
   * is embedded in real `venue` strings inconsistently, not a separate,
   * groupable value) — dropped rather than guessed at.
   */
  /**
   * POST /me/iqac/faculty-development/publications — the reference
   * design's "+ Add faculty entry" action for this metric. A real
   * faculty_publications row, not a fabricated one.
   */
  async createPublication(dto: {
    faculty_id: number;
    title: string;
    type: string;
    year?: number;
    venue?: string;
    doi?: string;
    citation_count?: number;
  }) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: dto.faculty_id },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty not found',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return this.prisma.faculty_publications.create({ data: dto });
  }

  async leadingPublicationVenues() {
    const rows = await this.prisma.faculty_publications.findMany({
      select: {
        venue: true,
        citation_count: true,
        faculty: { select: { departments: { select: { code: true } } } },
      },
    });

    const byVenue = new Map<
      string,
      { papers: number; citations: number; departments: Set<string> }
    >();
    for (const r of rows) {
      const venue = r.venue?.trim() || 'Unspecified venue';
      const entry = byVenue.get(venue) ?? {
        papers: 0,
        citations: 0,
        departments: new Set<string>(),
      };
      entry.papers += 1;
      entry.citations += r.citation_count;
      const deptCode = r.faculty?.departments?.code;
      if (deptCode) entry.departments.add(deptCode);
      byVenue.set(venue, entry);
    }

    return Array.from(byVenue.entries())
      .map(([venue, e]) => ({
        venue,
        papers: e.papers,
        citations: e.citations,
        department_codes: Array.from(e.departments),
      }))
      .sort((a, b) => b.papers - a.papers);
  }

  /**
   * GET /me/iqac/faculty-development/publications/departments —
   * department-wise rollup for the Publications leading-entries panel,
   * matching the reference design's always-8-department rollup grid.
   */
  async publicationDepartments() {
    const [departments, rows] = await Promise.all([
      this.prisma.departments.findMany({
        select: { id: true, name: true, code: true },
      }),
      this.prisma.faculty_publications.findMany({
        select: {
          citation_count: true,
          faculty: { select: { department_id: true } },
        },
      }),
    ]);

    const byDept = new Map<number, { papers: number; citations: number }>();
    for (const r of rows) {
      const deptId = r.faculty?.department_id;
      if (deptId == null) continue;
      const entry = byDept.get(deptId) ?? { papers: 0, citations: 0 };
      entry.papers += 1;
      entry.citations += r.citation_count;
      byDept.set(deptId, entry);
    }

    return departments.map((dept) => ({
      department: dept,
      papers: byDept.get(dept.id)?.papers ?? 0,
      citations: byDept.get(dept.id)?.citations ?? 0,
    }));
  }

  /**
   * GET /me/principal/faculty/publications/venues/:venue — every real paper
   * on file for one venue. `venue` is nullable/blankable in the schema, and
   * leadingPublicationVenues() above buckets those under the display label
   * "Unspecified venue" — match that sentinel back to the real null/blank
   * rows here so the drill-through isn't a dead end for that bucket.
   */
  async venuePublications(venue: string) {
    const where =
      venue === 'Unspecified venue'
        ? { OR: [{ venue: null }, { venue: '' }] }
        : { venue };

    const rows = await this.prisma.faculty_publications.findMany({
      where,
      orderBy: { year: 'desc' },
      select: {
        id: true,
        title: true,
        type: true,
        year: true,
        doi: true,
        citation_count: true,
        faculty: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            departments: { select: { code: true } },
          },
        },
      },
    });

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      type: r.type,
      year: r.year,
      doi: r.doi,
      citation_count: r.citation_count,
      author: {
        faculty_id: r.faculty.id,
        name: `${r.faculty.first_name} ${r.faculty.last_name}`,
        department_code: r.faculty.departments?.code ?? null,
      },
    }));
  }
}
