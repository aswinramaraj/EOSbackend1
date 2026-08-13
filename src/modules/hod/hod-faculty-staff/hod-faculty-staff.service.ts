import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { FacultyAttendanceService } from 'src/modules/faculty/faculty-attendance/faculty-attendance.service';

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function yearLabelForSemester(semester: number): string {
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

/** Same academic-year convention used elsewhere in this codebase (e.g. hr-requests.service.ts) — an academic year starts in June. */
function academicYearFor(date: Date): string {
  const calendarYear = date.getUTCFullYear();
  const academicStartYear =
    date.getUTCMonth() + 1 >= 6 ? calendarYear : calendarYear - 1;
  return `${academicStartYear}-${String((academicStartYear + 1) % 100).padStart(2, '0')}`;
}

function fullName(p: {
  prefix?: string | null;
  first_name: string;
  last_name?: string | null;
}): string {
  return [p.prefix, p.first_name, p.last_name].filter(Boolean).join(' ');
}

function slotHours(slots: { start_time: Date; end_time: Date }[]): number {
  const minutes = slots.reduce((sum, s) => {
    const diff = (s.end_time.getTime() - s.start_time.getTime()) / (1000 * 60);
    return sum + Math.max(0, diff);
  }, 0);
  return Math.round((minutes / 60) * 10) / 10;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
}

@Injectable()
export class HodFacultyStaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facultyAttendanceService: FacultyAttendanceService,
  ) {}

  /** Resolves the caller's own faculty row + department — never trusts a client-supplied department_id. */
  async resolveHodDepartment(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true, department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    const department = await this.prisma.departments.findUnique({
      where: { id: faculty.department_id },
      select: { id: true, name: true, code: true },
    });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    return { faculty, department };
  }

  /** GET /hod/faculty-staff/overview */
  async getOverview(userId: number) {
    const { department } = await this.resolveHodDepartment(userId);

    const [facultyOverview, nonTeachingCount, pendingLeaves, cycle] =
      await Promise.all([
        this.facultyAttendanceService.getOverview(department.id),
        this.prisma.non_teaching_staff.count({
          where: { department_id: department.id, status: 'active' },
        }),
        this.prisma.faculty_leaves.count({
          where: {
            faculty: { department_id: department.id },
            hod_approval_status: 'pending',
          },
        }),
        this.prisma.appraisal_cycles.findFirst({
          where: { is_active: true },
          orderBy: { start_date: 'desc' },
          select: { academic_year: true, end_date: true },
        }),
      ]);

    const teachingCount = facultyOverview.rows.length;
    const reported =
      facultyOverview.today.full_days + facultyOverview.today.half_days;

    let appraisal: {
      closed: number;
      total: number;
      cycle_academic_year: string | null;
      cycle_end_date: string | null;
    } = {
      closed: 0,
      total: 0,
      cycle_academic_year: null,
      cycle_end_date: null,
    };
    if (cycle) {
      const [total, closed] = await Promise.all([
        this.prisma.appraisal_requests.count({
          where: {
            faculty: { department_id: department.id },
            academic_year: cycle.academic_year,
          },
        }),
        this.prisma.appraisal_requests.count({
          where: {
            faculty: { department_id: department.id },
            academic_year: cycle.academic_year,
            status: { not: 'submitted' },
          },
        }),
      ]);
      appraisal = {
        closed,
        total,
        cycle_academic_year: cycle.academic_year,
        cycle_end_date: cycle.end_date.toISOString().slice(0, 10),
      };
    }

    return {
      department,
      employee_count: teachingCount + nonTeachingCount,
      teaching_count: teachingCount,
      non_teaching_count: nonTeachingCount,
      faculty_attendance: {
        percentage: facultyOverview.today.attendance_percentage,
        reported,
        on_roll: teachingCount,
        on_leave: facultyOverview.today.on_leave,
        on_duty: facultyOverview.today.on_duty,
      },
      on_duty_today: {
        count: reported,
        on_approved_leave: facultyOverview.today.on_leave,
      },
      leave_requests_pending: pendingLeaves,
      appraisal,
    };
  }

  /** GET /hod/faculty-staff/list?type=all|teaching|non_teaching&search= */
  async getList(
    userId: number,
    type: 'all' | 'teaching' | 'non_teaching',
    search?: string,
  ) {
    const { department } = await this.resolveHodDepartment(userId);
    const academicYear = academicYearFor(new Date());

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

    if (type !== 'non_teaching') {
      const facultyRows = await this.prisma.faculty.findMany({
        where: {
          department_id: department.id,
          status: 'active',
          OR: search
            ? [
                { first_name: { contains: search, mode: 'insensitive' } },
                { last_name: { contains: search, mode: 'insensitive' } },
                { designation: { contains: search, mode: 'insensitive' } },
                { qualification: { contains: search, mode: 'insensitive' } },
              ]
            : undefined,
        },
        select: {
          id: true,
          prefix: true,
          first_name: true,
          last_name: true,
          designation: true,
          profile_url: true,
          departments: { select: { code: true } },
        },
        orderBy: { id: 'asc' },
      });
      const facultyIds = facultyRows.map((f) => f.id);

      const [attendanceOverview, timetableRows] = await Promise.all([
        this.facultyAttendanceService.getOverview(department.id),
        facultyIds.length
          ? this.prisma.timetable_slots.findMany({
              where: {
                faculty_id: { in: facultyIds },
                academic_year: academicYear,
              },
              select: { faculty_id: true, start_time: true, end_time: true },
            })
          : [],
      ]);
      const attendanceByFaculty = new Map(
        attendanceOverview.rows.map((r) => [r.faculty_id, r]),
      );
      const slotsByFaculty = new Map<
        number,
        { start_time: Date; end_time: Date }[]
      >();
      for (const slot of timetableRows) {
        const list = slotsByFaculty.get(slot.faculty_id) ?? [];
        list.push(slot);
        slotsByFaculty.set(slot.faculty_id, list);
      }

      for (const f of facultyRows) {
        const attendance = attendanceByFaculty.get(f.id);
        const slots = slotsByFaculty.get(f.id) ?? [];
        rows.push({
          kind: 'faculty',
          id: f.id,
          name: fullName(f),
          designation: f.designation,
          department_code: f.departments.code,
          photo_url: f.profile_url,
          attendance_percent: attendance?.attendance_percentage ?? null,
          load_hours: slots.length ? slotHours(slots) : null,
          status_label: statusLabel(attendance?.today_status ?? null),
        });
      }
    }

    if (type !== 'teaching') {
      const staffRows = await this.prisma.non_teaching_staff.findMany({
        where: {
          department_id: department.id,
          status: 'active',
          OR: search
            ? [
                { first_name: { contains: search, mode: 'insensitive' } },
                { last_name: { contains: search, mode: 'insensitive' } },
              ]
            : undefined,
        },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          category: true,
          departments: { select: { code: true } },
        },
        orderBy: { id: 'asc' },
      });
      for (const s of staffRows) {
        rows.push({
          kind: 'non_teaching',
          id: s.id,
          name: fullName(s),
          designation: categoryLabel(s.category),
          department_code: s.departments?.code ?? department.code,
          // No photo column exists on non_teaching_staff anywhere in the schema.
          photo_url: null,
          attendance_percent: null,
          load_hours: null,
          status_label: null,
        });
      }
    }

    rows.sort((a, b) => a.name.localeCompare(b.name));
    return { department, rows };
  }

  /** GET /hod/faculty-staff/faculty/:id */
  async getFacultyProfile(userId: number, facultyId: number) {
    const { department } = await this.resolveHodDepartment(userId);
    const academicYear = academicYearFor(new Date());

    const faculty = await this.prisma.faculty.findFirst({
      where: { id: facultyId, department_id: department.id },
      select: {
        id: true,
        prefix: true,
        first_name: true,
        last_name: true,
        designation: true,
        qualification: true,
        specialization: true,
        date_of_joining: true,
        previous_experience_years: true,
        profile_url: true,
        departments: { select: { name: true, code: true } },
        users: { select: { email: true, phone: true } },
      },
    });
    if (!faculty) {
      throw new NotFoundException('Faculty not found in this department');
    }

    const [
      attendance,
      todayOverview,
      timetableRows,
      mentorClass,
      mappingRows,
      leaveBalances,
      odRequests,
      cycle,
    ] = await Promise.all([
      this.facultyAttendanceService.getForFaculty(facultyId, academicYear),
      this.facultyAttendanceService.getOverview(department.id),
      this.prisma.timetable_slots.findMany({
        where: { faculty_id: facultyId, academic_year: academicYear },
        select: {
          subject_id: true,
          class_id: true,
          start_time: true,
          end_time: true,
        },
      }),
      this.prisma.class_mentors.findFirst({
        where: { faculty_id: facultyId, academic_year: academicYear },
        select: {
          classes: { select: { section: true, current_semester: true } },
        },
      }),
      this.prisma.faculty_subject_class_mapping.findMany({
        where: { faculty_id: facultyId, academic_year: academicYear },
        select: {
          subject_id: true,
          subjects: { select: { id: true, name: true, subject_code: true } },
          classes: {
            select: { id: true, section: true, current_semester: true },
          },
        },
      }),
      this.prisma.faculty_leave_balances.findMany({
        where: { faculty_id: facultyId, academic_year: academicYear },
        select: {
          allocated: true,
          used: true,
          leave_types: { select: { name: true } },
        },
      }),
      this.prisma.faculty_od_requests.findMany({
        where: {
          faculty_id: facultyId,
          hod_approval_status: 'approved',
          hr_approval_status: 'approved',
          from_date: { gte: academicYearStart(academicYear) },
          to_date: { lt: academicYearEnd(academicYear) },
        },
        select: { from_date: true, to_date: true },
      }),
      this.prisma.appraisal_cycles.findFirst({
        where: { is_active: true },
        orderBy: { start_date: 'desc' },
        select: { academic_year: true, end_date: true },
      }),
    ]);

    const totalPeriods = timetableRows.length;
    const totalHours = totalPeriods ? slotHours(timetableRows) : null;

    const experienceYears =
      faculty.date_of_joining != null
        ? Math.floor(
            (Date.now() - faculty.date_of_joining.getTime()) /
              (365.25 * 86400000),
          ) + (faculty.previous_experience_years ?? 0)
        : (faculty.previous_experience_years ?? null);

    const periodsBySubjectClass = new Map<string, number>();
    for (const slot of timetableRows) {
      const key = `${slot.subject_id}-${slot.class_id}`;
      periodsBySubjectClass.set(key, (periodsBySubjectClass.get(key) ?? 0) + 1);
    }
    const subjects = mappingRows.map((m) => ({
      subject_id: m.subjects.id,
      code: m.subjects.subject_code,
      name: m.subjects.name,
      class_id: m.classes.id,
      semester: m.classes.current_semester,
      year_label:
        m.classes.current_semester != null
          ? yearLabelForSemester(m.classes.current_semester)
          : null,
      section: m.classes.section,
      periods_per_week:
        periodsBySubjectClass.get(`${m.subject_id}-${m.classes.id}`) ?? 0,
    }));

    let appraisal: {
      status: string | null;
      cycle_academic_year: string | null;
      cycle_end_date: string | null;
    } = { status: null, cycle_academic_year: null, cycle_end_date: null };
    if (cycle) {
      const request = await this.prisma.appraisal_requests.findFirst({
        where: { faculty_id: facultyId, academic_year: cycle.academic_year },
        select: { status: true },
      });
      appraisal = {
        status: request?.status ?? null,
        cycle_academic_year: cycle.academic_year,
        cycle_end_date: cycle.end_date.toISOString().slice(0, 10),
      };
    }

    const onDutyDays = odRequests.reduce(
      (sum, r) => sum + daysBetween(r.from_date, r.to_date),
      0,
    );

    const todayRow = todayOverview.rows.find((r) => r.faculty_id === facultyId);
    const todayStatusLabel = statusLabel(todayRow?.today_status ?? null);

    return {
      department,
      faculty: {
        id: faculty.id,
        name: fullName(faculty),
        designation: faculty.designation,
        qualification: faculty.qualification,
        specialization: faculty.specialization,
        photo_url: faculty.profile_url,
        department_name: faculty.departments.name,
        department_code: faculty.departments.code,
        institute_email: faculty.users.email,
        contact_number: faculty.users.phone,
        date_of_joining: faculty.date_of_joining
          ? faculty.date_of_joining.toISOString().slice(0, 10)
          : null,
        experience_years: experienceYears,
      },
      attendance_this_term: attendance.overall.attendance_percentage,
      today_status_label: todayStatusLabel,
      workload: { periods_per_week: totalPeriods, hours_per_week: totalHours },
      advisory_class: mentorClass
        ? {
            section: mentorClass.classes.section,
            year_label:
              mentorClass.classes.current_semester != null
                ? yearLabelForSemester(mentorClass.classes.current_semester)
                : null,
          }
        : null,
      subjects,
      leave_balances: leaveBalances.map((b) => ({
        leave_type: b.leave_types.name,
        allocated: b.allocated,
        used: b.used,
      })),
      on_duty_days_this_term: onDutyDays,
      appraisal,
      academic_year: academicYear,
    };
  }

  /** GET /hod/faculty-staff/non-teaching/:id */
  async getNonTeachingProfile(userId: number, staffId: number) {
    const { department } = await this.resolveHodDepartment(userId);

    const staff = await this.prisma.non_teaching_staff.findFirst({
      where: { id: staffId, department_id: department.id },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        category: true,
        date_of_joining: true,
        status: true,
        departments: { select: { name: true, code: true } },
        users: { select: { email: true, phone: true } },
      },
    });
    if (!staff) {
      throw new NotFoundException('Staff member not found in this department');
    }

    return {
      department,
      staff: {
        id: staff.id,
        name: fullName(staff),
        category: categoryLabel(staff.category),
        department_name: staff.departments?.name ?? department.name,
        department_code: staff.departments?.code ?? department.code,
        institute_email: staff.users?.email ?? null,
        contact_number: staff.users?.phone ?? null,
        date_of_joining: staff.date_of_joining
          ? staff.date_of_joining.toISOString().slice(0, 10)
          : null,
        status: staff.status,
      },
    };
  }
}

function statusLabel(today_status: string | null): string | null {
  switch (today_status) {
    case 'full_day':
    case 'half_day':
      return 'On duty';
    case 'on_leave':
      return 'On leave';
    case 'on_duty':
      return 'On OD';
    case 'on_vacation':
      return 'On vacation';
    case 'absent':
      return 'Absent';
    default:
      return null;
  }
}

function categoryLabel(category: string): string {
  return category
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function academicYearStart(academicYear: string): Date {
  const startYear = Number(academicYear.slice(0, 4));
  return new Date(`${startYear}-06-01T00:00:00.000Z`);
}

function academicYearEnd(academicYear: string): Date {
  const startYear = Number(academicYear.slice(0, 4));
  return new Date(`${startYear + 1}-06-01T00:00:00.000Z`);
}
