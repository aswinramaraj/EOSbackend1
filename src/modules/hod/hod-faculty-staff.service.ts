import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { FacultyAttendanceService } from '../faculty/faculty-attendance/faculty-attendance.service';

/**
 * Same Odd/Even semester convention duplicated in every hod service file
 * (see HodService's own copy for the canonical comment on why it's
 * duplicated rather than shared).
 */
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

function yearLabel(semester: number | null): string | null {
  if (semester == null) return null;
  return ['I', 'II', 'III', 'IV'][Math.ceil(semester / 2) - 1] ?? null;
}

/**
 * GET /hod/faculty-staff/overview and /hod/faculty-staff/list —
 * department-scoped staff roster. Real tables: `faculty`, `non_teaching_staff`
 * (both have `department_id`), `faculty_leaves` (pending count), reuses
 * `FacultyAttendanceService.getOverview` wholesale for attendance (same
 * real punch/leave/OD precedence rules as HodService's dashboard). Every
 * query sequential — Supabase's session-mode pool caps at 15 connections.
 */
@Injectable()
export class HodFacultyStaffService {
  private readonly logger = new Logger(HodFacultyStaffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly facultyAttendance: FacultyAttendanceService,
  ) {}

  private async resolveDepartmentId(user: JwtPayload): Promise<number> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty.department_id;
  }

  async getOverview(user: JwtPayload) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const department = await this.prisma.departments.findUnique({
        where: { id: departmentId },
        select: { id: true, name: true, code: true },
      });
      if (!department) {
        throw new NotFoundException({
          message: 'Department not found.',
          errorCode: 'DEPARTMENT_NOT_FOUND',
        });
      }

      const facultyOverview =
        await this.facultyAttendance.getOverview(departmentId);
      const teachingCount = facultyOverview.rows.length;
      const facultyReported = facultyOverview.rows.filter(
        (r) => r.today_status !== null,
      ).length;

      const nonTeachingCount = await this.prisma.non_teaching_staff.count({
        where: { department_id: departmentId, status: 'active' },
      });

      // Real distinct designation/category values for this department only
      // (never a hardcoded list) — backs the faculty-staff list's
      // designation filter dropdown.
      const facultyDesignationRows = await this.prisma.faculty.findMany({
        where: { department_id: departmentId, status: 'active' },
        select: { designation: true },
        distinct: ['designation'],
      });
      const nonTeachingCategoryRows =
        await this.prisma.non_teaching_staff.findMany({
          where: { department_id: departmentId, status: 'active' },
          select: { category: true },
          distinct: ['category'],
        });
      const designations = [
        ...new Set([
          ...facultyDesignationRows.map((d) => d.designation),
          ...nonTeachingCategoryRows.map((c) => c.category),
        ]),
      ]
        .filter((d): d is string => Boolean(d))
        .sort();

      const leaveRequestsPending = await this.prisma.faculty_leaves.count({
        where: {
          hod_approval_status: 'pending',
          faculty: { department_id: departmentId },
        },
      });

      const activeCycle = await this.prisma.appraisal_cycles.findFirst({
        where: { is_active: true },
        orderBy: { start_date: 'desc' },
        select: { academic_year: true, end_date: true },
      });

      let appraisalClosed = 0;
      let appraisalTotal = 0;
      if (activeCycle) {
        appraisalTotal = await this.prisma.appraisal_requests.count({
          where: {
            academic_year: activeCycle.academic_year,
            faculty: { department_id: departmentId },
          },
        });
        appraisalClosed = await this.prisma.appraisal_requests.count({
          where: {
            academic_year: activeCycle.academic_year,
            faculty: { department_id: departmentId },
            status: { in: ['management_approved', 'rejected'] },
          },
        });
      }

      return {
        department: {
          id: department.id,
          name: department.name,
          code: department.code,
        },
        employee_count: teachingCount + nonTeachingCount,
        teaching_count: teachingCount,
        non_teaching_count: nonTeachingCount,
        designations,
        faculty_attendance: {
          percentage: facultyOverview.today.attendance_percentage,
          reported: facultyReported,
          on_roll: teachingCount,
          on_leave: facultyOverview.today.on_leave,
          on_duty: facultyOverview.today.on_duty,
        },
        on_duty_today: {
          count: facultyOverview.today.on_duty,
          on_approved_leave: facultyOverview.today.on_leave,
        },
        leave_requests_pending: leaveRequestsPending,
        appraisal: {
          closed: appraisalClosed,
          total: appraisalTotal,
          cycle_academic_year: activeCycle?.academic_year ?? null,
          cycle_end_date: activeCycle?.end_date?.toISOString() ?? null,
        },
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD faculty-staff overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async getList(
    user: JwtPayload,
    type: 'all' | 'teaching' | 'non_teaching',
    search?: string,
    designation?: string,
  ) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const department = await this.prisma.departments.findUnique({
        where: { id: departmentId },
        select: { code: true },
      });
      if (!department) {
        throw new NotFoundException({
          message: 'Department not found.',
          errorCode: 'DEPARTMENT_NOT_FOUND',
        });
      }

      const rows: {
        kind: 'faculty' | 'non_teaching';
        id: number;
        name: string;
        designation: string;
        department_code: string;
        photo_url: string | null;
        attendance_percent: number | null;
        load_hours: number | null;
        status_label: string | null;
      }[] = [];

      // Fetched without `search` here (unlike before) because the search
      // needs to also match designation/category, which the shared
      // FacultyAttendanceService.getOverview's own name-only search can't
      // do — search+designation are both applied below, after designation
      // is joined in, rather than editing that shared service.
      if (type === 'all' || type === 'teaching') {
        const facultyOverview =
          await this.facultyAttendance.getOverview(departmentId);
        // designation isn't in FacultyAttendanceService's select — fetch it
        // directly rather than editing that shared service's select shape.
        const facultyIds = facultyOverview.rows.map((f) => f.faculty_id);
        const designationRows =
          facultyIds.length > 0
            ? await this.prisma.faculty.findMany({
                where: { id: { in: facultyIds } },
                select: { id: true, designation: true },
              })
            : [];
        const designationById = new Map(
          designationRows.map((d) => [d.id, d.designation]),
        );
        // Weekly teaching load — same real timetable_slots duration-sum
        // PrincipalDashboardService.facultyWorkloadFlags() uses, not a
        // stored field (none exists).
        const slots =
          facultyIds.length > 0
            ? await this.prisma.timetable_slots.findMany({
                where: { faculty_id: { in: facultyIds } },
                select: { faculty_id: true, start_time: true, end_time: true },
              })
            : [];
        const loadHoursById = new Map<number, number>();
        for (const s of slots) {
          const hours =
            (s.end_time.getTime() - s.start_time.getTime()) / 3_600_000;
          loadHoursById.set(
            s.faculty_id,
            (loadHoursById.get(s.faculty_id) ?? 0) + hours,
          );
        }
        for (const f of facultyOverview.rows) {
          // No attendance_records ever for this faculty member — a real
          // 0% would misleadingly read as "always absent" instead of
          // "nothing recorded yet" (same convention as the dashboard cards).
          const hasAnyRecord =
            f.full_days + f.half_days + f.absent + f.on_leave > 0;
          const name =
            `${f.prefix ?? ''} ${f.first_name} ${f.last_name}`.trim();
          const facultyDesignation = designationById.get(f.faculty_id) ?? '';
          if (designation && facultyDesignation !== designation) continue;
          if (
            search &&
            !name.toLowerCase().includes(search.toLowerCase()) &&
            !facultyDesignation.toLowerCase().includes(search.toLowerCase())
          ) {
            continue;
          }
          rows.push({
            kind: 'faculty',
            id: f.faculty_id,
            name,
            designation: facultyDesignation,
            department_code: department.code,
            photo_url: f.profile_url,
            attendance_percent: hasAnyRecord ? f.attendance_percentage : null,
            load_hours: loadHoursById.has(f.faculty_id)
              ? Math.round(loadHoursById.get(f.faculty_id)! * 10) / 10
              : null,
            status_label: f.today_status,
          });
        }
      }

      if (type === 'all' || type === 'non_teaching') {
        // `category` is a Postgres enum (Prisma has no `contains` filter for
        // enums), and it also needs to combine with free-text name search —
        // fetched unfiltered and matched in JS, same approach as the
        // faculty branch above.
        const staff = await this.prisma.non_teaching_staff.findMany({
          where: { department_id: departmentId, status: 'active' },
          select: {
            id: true,
            first_name: true,
            last_name: true,
            category: true,
          },
        });
        for (const s of staff) {
          const name = `${s.first_name} ${s.last_name ?? ''}`.trim();
          if (designation && s.category !== designation) continue;
          if (
            search &&
            !name.toLowerCase().includes(search.toLowerCase()) &&
            !s.category.toLowerCase().includes(search.toLowerCase())
          ) {
            continue;
          }
          rows.push({
            kind: 'non_teaching',
            id: s.id,
            name,
            designation: s.category,
            department_code: department.code,
            photo_url: null,
            attendance_percent: null,
            load_hours: null,
            status_label: null,
          });
        }
      }

      return { department: { code: department.code }, rows };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error listing HoD faculty-staff', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hod/faculty-staff/faculty/:id — one faculty member's profile,
   * scoped to the caller's own department (404 otherwise). Real tables:
   * `faculty`/`users` for identity+contact, `faculty_subject_class_mapping`
   * for teaching load, `timetable_slots` (count, per the same real
   * convention TimetableService.getCurrentSemesterForFaculty already uses —
   * one period counted as one hour, no separate duration tracking exists),
   * `class_mentors` for advisory class, `faculty_leave_balances`+
   * `leave_types` for leave balances, `faculty_daily_attendance` for
   * term attendance/on-duty days, `appraisal_requests`+`appraisal_cycles`
   * for appraisal status. Every query sequential.
   */
  async getFacultyProfile(user: JwtPayload, facultyId: number) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const target = await this.prisma.faculty.findUnique({
        where: { id: facultyId },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          designation: true,
          qualification: true,
          specialization: true,
          profile_url: true,
          date_of_joining: true,
          previous_experience_years: true,
          department_id: true,
          departments: { select: { id: true, name: true, code: true } },
          users: { select: { email: true, phone: true } },
        },
      });
      if (!target || target.department_id !== departmentId) {
        throw new NotFoundException({
          message: 'Faculty member not found in your department.',
          errorCode: 'FACULTY_NOT_FOUND',
        });
      }

      const facultyOverview =
        await this.facultyAttendance.getOverview(departmentId);
      const overviewRow = facultyOverview.rows.find(
        (r) => r.faculty_id === facultyId,
      );

      const { start: termStart, end: termEnd } = currentTermRange(new Date());
      const [termStatusRows] = [
        await this.prisma.$queryRaw<{ status: string; count: bigint }[]>`
          SELECT status, COUNT(*)::bigint AS count
          FROM faculty_daily_attendance
          WHERE faculty_id = ${facultyId} AND attendance_date BETWEEN ${termStart} AND ${termEnd}
          GROUP BY status
        `,
      ];
      const termCountByStatus = new Map(
        termStatusRows.map((r) => [r.status, Number(r.count)]),
      );
      const termFull = termCountByStatus.get('full_day') ?? 0;
      const termHalf = termCountByStatus.get('half_day') ?? 0;
      const termAbsent = termCountByStatus.get('absent') ?? 0;
      const termOnLeave = termCountByStatus.get('on_leave') ?? 0;
      const termOnDuty = termCountByStatus.get('on_duty') ?? 0;
      const termDenominator = termFull + termHalf + termAbsent + termOnLeave;
      const attendanceThisTerm =
        termDenominator > 0
          ? Math.round(((termFull + termHalf * 0.5) / termDenominator) * 100)
          : null;

      const latestMapping =
        await this.prisma.faculty_subject_class_mapping.findFirst({
          where: { faculty_id: facultyId },
          orderBy: { academic_year: 'desc' },
          select: { academic_year: true },
        });
      const academicYear = latestMapping?.academic_year ?? null;

      const mappings = academicYear
        ? await this.prisma.faculty_subject_class_mapping.findMany({
            where: { faculty_id: facultyId, academic_year: academicYear },
            select: {
              subject_id: true,
              class_id: true,
              subjects: { select: { name: true, subject_code: true } },
              classes: { select: { section: true, current_semester: true } },
            },
            orderBy: [{ class_id: 'asc' }, { subject_id: 'asc' }],
          })
        : [];

      const subjects: {
        subject_id: number;
        code: string;
        name: string;
        class_id: number;
        semester: number | null;
        year_label: string | null;
        section: string;
        periods_per_week: number;
      }[] = [];
      // Sequential — one count() per subject mapping, same pooler-capacity
      // discipline as every other hod service.
      for (const m of mappings) {
        const periodsPerWeek = await this.prisma.timetable_slots.count({
          where: {
            faculty_id: facultyId,
            subject_id: m.subject_id,
            class_id: m.class_id,
            academic_year: academicYear!,
          },
        });
        subjects.push({
          subject_id: m.subject_id,
          code: m.subjects.subject_code,
          name: m.subjects.name,
          class_id: m.class_id,
          semester: m.classes.current_semester,
          year_label: yearLabel(m.classes.current_semester),
          section: m.classes.section,
          periods_per_week: periodsPerWeek,
        });
      }
      const totalPeriodsPerWeek = subjects.reduce(
        (sum, s) => sum + s.periods_per_week,
        0,
      );

      const mentorRow = await this.prisma.class_mentors.findFirst({
        where: { faculty_id: facultyId },
        orderBy: { academic_year: 'desc' },
        select: {
          classes: { select: { section: true, current_semester: true } },
        },
      });
      const advisoryClass = mentorRow
        ? {
            section: mentorRow.classes.section,
            year_label: yearLabel(mentorRow.classes.current_semester),
          }
        : null;

      const leaveBalanceRows =
        await this.prisma.faculty_leave_balances.findMany({
          where: { faculty_id: facultyId },
          orderBy: { academic_year: 'desc' },
          select: {
            academic_year: true,
            allocated: true,
            used: true,
            leave_types: { select: { name: true } },
          },
        });
      const latestBalanceYear = leaveBalanceRows[0]?.academic_year;
      const leaveBalances = leaveBalanceRows
        .filter((r) => r.academic_year === latestBalanceYear)
        .map((r) => ({
          leave_type: r.leave_types.name,
          allocated: r.allocated,
          used: r.used,
        }));

      const activeCycle = await this.prisma.appraisal_cycles.findFirst({
        where: { is_active: true },
        orderBy: { start_date: 'desc' },
        select: { academic_year: true, end_date: true },
      });
      const appraisalRequest = activeCycle
        ? await this.prisma.appraisal_requests.findFirst({
            where: {
              faculty_id: facultyId,
              academic_year: activeCycle.academic_year,
            },
            orderBy: { created_at: 'desc' },
            select: { status: true },
          })
        : null;

      return {
        department: {
          id: target.departments.id,
          name: target.departments.name,
          code: target.departments.code,
        },
        faculty: {
          id: target.id,
          name: `${target.first_name} ${target.last_name}`.trim(),
          designation: target.designation,
          qualification: target.qualification,
          specialization: target.specialization,
          photo_url: target.profile_url,
          department_name: target.departments.name,
          department_code: target.departments.code,
          institute_email: target.users?.email ?? null,
          contact_number: target.users?.phone ?? null,
          date_of_joining: target.date_of_joining?.toISOString() ?? null,
          experience_years: target.previous_experience_years,
        },
        attendance_this_term: attendanceThisTerm,
        today_status_label: overviewRow?.today_status ?? null,
        workload: {
          periods_per_week: totalPeriodsPerWeek,
          hours_per_week: totalPeriodsPerWeek,
        },
        advisory_class: advisoryClass,
        subjects,
        leave_balances: leaveBalances,
        on_duty_days_this_term: termOnDuty,
        appraisal: {
          status: appraisalRequest?.status ?? null,
          cycle_academic_year: activeCycle?.academic_year ?? null,
          cycle_end_date: activeCycle?.end_date?.toISOString() ?? null,
        },
        academic_year: academicYear ?? activeCycle?.academic_year ?? '',
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD faculty profile', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hod/faculty-staff/non-teaching/:id — one non-teaching staff
   * member's profile, scoped to the caller's own department (404
   * otherwise). Real tables: `non_teaching_staff`/`users`.
   */
  async getNonTeachingProfile(user: JwtPayload, staffId: number) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const staff = await this.prisma.non_teaching_staff.findUnique({
        where: { id: staffId },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          category: true,
          department_id: true,
          date_of_joining: true,
          status: true,
          departments: { select: { id: true, name: true, code: true } },
          users: { select: { email: true, phone: true } },
        },
      });
      if (
        !staff ||
        staff.department_id !== departmentId ||
        !staff.departments
      ) {
        throw new NotFoundException({
          message: 'Staff member not found in your department.',
          errorCode: 'STAFF_NOT_FOUND',
        });
      }

      return {
        department: {
          id: staff.departments.id,
          name: staff.departments.name,
          code: staff.departments.code,
        },
        staff: {
          id: staff.id,
          name: `${staff.first_name} ${staff.last_name ?? ''}`.trim(),
          category: staff.category,
          department_name: staff.departments.name,
          department_code: staff.departments.code,
          institute_email: staff.users?.email ?? null,
          contact_number: staff.users?.phone ?? null,
          date_of_joining: staff.date_of_joining?.toISOString() ?? null,
          status: staff.status,
        },
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD non-teaching profile', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
