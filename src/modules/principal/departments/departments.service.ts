import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AssignHodDto } from './dto/assign-hod.dto';

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

const HOD_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  designation: true,
} as const;

function hodDto(
  row: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
  } | null,
) {
  if (!row) return null;
  return {
    faculty_id: row.id,
    name: `${row.first_name} ${row.last_name}`,
    designation: row.designation,
  };
}

@Injectable()
export class PrincipalDepartmentsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/principal/departments
   *
   * Department cards. `head_of_department_faculty_id` is a real FK column,
   * but it's null for every department in this database today — rendered
   * honestly as `hod: null` rather than inferred from `faculty.designation`
   * free text (ambiguous: some departments have more than one faculty with
   * a "Head"-style designation). Use PATCH .../hod to actually set it.
   *
   * Student/faculty counts and attendance/placement % all follow the same
   * classes.department_id-preferred, courses.department_id-fallback pattern
   * already used in PrincipalStudentsService (the two paths never disagree
   * where both exist — only 3 of 133 students lack a class_id entirely).
   */
  async list() {
    const [
      departments,
      students,
      facultyCounts,
      attendanceRows,
      placedStudentIds,
    ] = await Promise.all([
      this.prisma.departments.findMany({
        select: {
          id: true,
          name: true,
          code: true,
          faculty_departments_head_of_department_faculty_idTofaculty: {
            select: HOD_SELECT,
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.students.findMany({
        where: { status: 'active' },
        select: {
          id: true,
          classes: { select: { department_id: true } },
          courses: { select: { department_id: true } },
        },
      }),
      this.prisma.faculty.groupBy({
        by: ['department_id'],
        where: { status: 'active' },
        _count: { _all: true },
      }),
      this.attendanceRowsForTerm(),
      this.placedStudentIds(),
    ]);

    const studentsByDept = new Map<number, number[]>();
    for (const s of students) {
      const deptId = s.classes?.department_id ?? s.courses?.department_id;
      if (deptId == null) continue;
      const list = studentsByDept.get(deptId) ?? [];
      list.push(s.id);
      studentsByDept.set(deptId, list);
    }

    const facultyCountByDept = new Map(
      facultyCounts.map((f) => [f.department_id, f._count._all]),
    );

    const attendanceByDept = this.aggregateAttendanceByDept(attendanceRows);

    return departments.map((dept) => {
      const studentIds = studentsByDept.get(dept.id) ?? [];
      const placed = studentIds.filter((id) => placedStudentIds.has(id)).length;
      const attendance = attendanceByDept.get(dept.id);

      return {
        id: dept.id,
        name: dept.name,
        code: dept.code,
        hod: hodDto(
          dept.faculty_departments_head_of_department_faculty_idTofaculty,
        ),
        students_count: studentIds.length,
        faculty_count: facultyCountByDept.get(dept.id) ?? 0,
        attendance_percentage:
          attendance && attendance.total > 0
            ? Math.round((attendance.present / attendance.total) * 1000) / 10
            : null,
        placement_percentage:
          studentIds.length > 0
            ? Math.round((placed / studentIds.length) * 1000) / 10
            : null,
      };
    });
  }

  /**
   * GET /me/principal/departments/:id
   *
   * "Mean CGPA" is always "—" (same confirmed gap as the Students page) —
   * the tile's real content is the placement subtitle underneath it
   * ("{placed} placed · {pct}% placement"), matching the reference design's
   * layout where that tile bundles both figures.
   */
  async findOne(id: number) {
    const dept = await this.prisma.departments.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        code: true,
        faculty_departments_head_of_department_faculty_idTofaculty: {
          select: HOD_SELECT,
        },
      },
    });
    if (!dept) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    const today = startOfToday();
    const [students, classesCount, todayFacultyAttendance, feesTotal] =
      await Promise.all([
        this.prisma.students.findMany({
          where: {
            status: 'active',
            OR: [
              { classes: { department_id: id } },
              { courses: { department_id: id } },
            ],
          },
          select: { id: true },
        }),
        this.prisma.classes.count({ where: { department_id: id } }),
        this.prisma.faculty_daily_attendance.findMany({
          where: { attendance_date: today, faculty: { department_id: id } },
          select: { status: true },
        }),
        this.departmentFeesOutstanding(id),
      ]);

    const studentIds = students.map((s) => s.id);
    const [studentAttendance, facultyTotal, placedStudentIds] =
      await Promise.all([
        this.attendancePercentageForStudents(studentIds),
        this.prisma.faculty.count({
          where: { department_id: id, status: 'active' },
        }),
        this.placedStudentIds(),
      ]);

    const placed = studentIds.filter((sid) => placedStudentIds.has(sid)).length;
    const reported = todayFacultyAttendance.filter((r) =>
      ['full_day', 'half_day', 'on_duty'].includes(r.status),
    ).length;
    const onLeave = todayFacultyAttendance.filter(
      (r) => r.status === 'on_leave',
    ).length;

    return {
      id: dept.id,
      name: dept.name,
      code: dept.code,
      hod: hodDto(
        dept.faculty_departments_head_of_department_faculty_idTofaculty,
      ),
      students_count: studentIds.length,
      faculty_count: facultyTotal,
      students: {
        attendance_percentage: studentAttendance,
        sections_count: classesCount,
      },
      faculty: {
        reporting_rate_today:
          facultyTotal > 0
            ? Math.round((reported / facultyTotal) * 1000) / 10
            : null,
        on_leave_today: onLeave,
        total_active: facultyTotal,
      },
      fees_pending_total: feesTotal,
      placement: {
        placed,
        total: studentIds.length,
        percentage:
          studentIds.length > 0
            ? Math.round((placed / studentIds.length) * 1000) / 10
            : null,
      },
    };
  }

  /**
   * GET /me/principal/departments/:id/sections
   *
   * "Current" class advisor: class_mentors has no is_current flag and its
   * academic_year strings are inconsistently formatted, so — matching this
   * codebase's own ClassMentorsService.getChildMentor() precedent — the
   * most recently assigned row (highest id) is treated as "the" advisor,
   * rather than a strict current-year match that would show "no advisor"
   * for most sections despite real data existing.
   *
   * "Faculty attendance" for a section is defined as the advisor's own
   * attendance this term (not an aggregate of every faculty who teaches the
   * section) — a design choice, not a schema gap; both are honestly
   * computable, this one keeps a 1:1 "who's responsible" reading.
   */
  async sections(departmentId: number) {
    const dept = await this.prisma.departments.findUnique({
      where: { id: departmentId },
    });
    if (!dept) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    const classes = await this.prisma.classes.findMany({
      where: { department_id: departmentId },
      select: {
        id: true,
        section: true,
        current_semester: true,
        class_mentors: {
          orderBy: { id: 'desc' },
          take: 1,
          select: {
            faculty: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                designation: true,
                users: { select: { email: true, phone: true } },
              },
            },
          },
        },
        students: { where: { status: 'active' }, select: { id: true } },
      },
      orderBy: { section: 'asc' },
    });

    const [placedStudentIds, advisorAttendance] = await Promise.all([
      this.placedStudentIds(),
      this.attendanceByFacultyIds(
        classes
          .map((c) => c.class_mentors[0]?.faculty.id)
          .filter((id): id is number => id != null),
      ),
    ]);

    return Promise.all(
      classes.map(async (cls) => {
        const advisor = cls.class_mentors[0]?.faculty ?? null;
        const studentIds = cls.students.map((s) => s.id);
        const [studentAttendance, feesPending] = await Promise.all([
          this.attendancePercentageForStudents(studentIds),
          this.feesOutstandingForStudents(studentIds),
        ]);
        const placed = studentIds.filter((id) =>
          placedStudentIds.has(id),
        ).length;

        return {
          id: cls.id,
          section: cls.section,
          semester: cls.current_semester,
          advisor: advisor
            ? {
                faculty_id: advisor.id,
                name: `${advisor.first_name} ${advisor.last_name}`,
                designation: advisor.designation,
                email: advisor.users.email,
                phone: advisor.users.phone,
              }
            : null,
          student_attendance_percentage: studentAttendance,
          faculty_attendance_percentage: advisor
            ? (advisorAttendance.get(advisor.id) ?? null)
            : null,
          total_students: studentIds.length,
          placed,
          fees_pending_amount: feesPending,
        };
      }),
    );
  }

  /**
   * PATCH /me/principal/departments/:id/hod — Principal directly assigns
   * (or clears, with faculty_id: null) which real faculty row heads a
   * department. This is the ONLY way head_of_department_faculty_id gets
   * set correctly — a designation string like "HOD" typed elsewhere never
   * touches this column and is ambiguous besides.
   */
  async assignHod(departmentId: number, dto: AssignHodDto) {
    const dept = await this.prisma.departments.findUnique({
      where: { id: departmentId },
    });
    if (!dept) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    if (dto.faculty_id != null) {
      const faculty = await this.prisma.faculty.findUnique({
        where: { id: dto.faculty_id },
      });
      if (!faculty) {
        throw new NotFoundException({
          message: 'Faculty not found',
          errorCode: 'FACULTY_NOT_FOUND',
        });
      }
      if (faculty.department_id !== departmentId) {
        throw new BadRequestException({
          message: 'The Head of Department must belong to this department',
          errorCode: 'FACULTY_WRONG_DEPARTMENT',
        });
      }
    }

    await this.prisma.departments.update({
      where: { id: departmentId },
      data: { head_of_department_faculty_id: dto.faculty_id },
    });

    return this.findOne(departmentId);
  }

  private async attendanceRowsForTerm() {
    const { start, end } = currentTermRange(startOfToday());
    return this.prisma.attendance_records.findMany({
      where: { attendance_date: { gte: start, lte: end } },
      select: { status: true, classes: { select: { department_id: true } } },
    });
  }

  private aggregateAttendanceByDept(
    rows: { status: string; classes: { department_id: number } }[],
  ): Map<number, { present: number; total: number }> {
    const byDept = new Map<number, { present: number; total: number }>();
    for (const r of rows) {
      const entry = byDept.get(r.classes.department_id) ?? {
        present: 0,
        total: 0,
      };
      entry.total += 1;
      if (r.status === 'present') entry.present += 1;
      byDept.set(r.classes.department_id, entry);
    }
    return byDept;
  }

  private async placedStudentIds(): Promise<Set<number>> {
    const rows = await this.prisma.student_drive_applications.findMany({
      where: { status: 'placed' },
      select: { student_id: true },
      distinct: ['student_id'],
    });
    return new Set(rows.map((r) => r.student_id));
  }

  private async attendancePercentageForStudents(
    studentIds: number[],
  ): Promise<number | null> {
    if (studentIds.length === 0) return null;
    const { start, end } = currentTermRange(startOfToday());
    const records = await this.prisma.attendance_records.findMany({
      where: {
        student_id: { in: studentIds },
        attendance_date: { gte: start, lte: end },
      },
      select: { status: true },
    });
    if (records.length === 0) return null;
    const present = records.filter((r) => r.status === 'present').length;
    return Math.round((present / records.length) * 1000) / 10;
  }

  private async attendanceByFacultyIds(
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
      const entry = byFaculty.get(r.faculty_id) ?? { earned: 0, total: 0 };
      entry.total += 1;
      if (r.status === 'full_day') entry.earned += 1;
      else if (r.status === 'half_day') entry.earned += 0.5;
      byFaculty.set(r.faculty_id, entry);
    }
    const result = new Map<number, number>();
    for (const [facultyId, entry] of byFaculty.entries()) {
      if (entry.total > 0)
        result.set(
          facultyId,
          Math.round((entry.earned / entry.total) * 1000) / 10,
        );
    }
    return result;
  }

  private async departmentFeesOutstanding(
    departmentId: number,
  ): Promise<number> {
    const students = await this.prisma.students.findMany({
      where: {
        status: 'active',
        OR: [
          { classes: { department_id: departmentId } },
          { courses: { department_id: departmentId } },
        ],
      },
      select: { id: true },
    });
    return this.feesOutstandingForStudents(students.map((s) => s.id));
  }

  private async feesOutstandingForStudents(
    studentIds: number[],
  ): Promise<number> {
    if (studentIds.length === 0) return 0;
    const demandMappings =
      await this.prisma.student_fee_demand_mapping.findMany({
        where: { student_id: { in: studentIds } },
        select: { id: true, total_amount: true },
      });
    if (demandMappings.length === 0) return 0;

    const paidByMapping = await this.prisma.fee_payments.groupBy({
      by: ['student_fee_demand_mapping_id'],
      where: {
        student_fee_demand_mapping_id: { in: demandMappings.map((m) => m.id) },
      },
      _sum: { amount_paid: true },
    });
    const paidMap = new Map(
      paidByMapping.map((p) => [
        p.student_fee_demand_mapping_id,
        Number(p._sum.amount_paid ?? 0),
      ]),
    );

    let total = 0;
    for (const m of demandMappings) {
      const outstanding = Number(m.total_amount) - (paidMap.get(m.id) ?? 0);
      if (outstanding > 0) total += outstanding;
    }
    return Math.round(total);
  }
}
