import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

interface HodRow {
  department_id: number;
  first_name: string;
  last_name: string;
  designation: string;
}
interface CountRow {
  department_id: number;
  count: bigint;
}
interface AttendanceRow {
  department_id: number;
  pct: string | null;
}
interface PlacementRow {
  department_id: number;
  applicants: bigint;
  placed: bigint;
}
interface CourseRow {
  id: number;
  department_id: number;
  name: string;
  code: string;
  duration_years: number;
}

/**
 * Principal-only Departments & HoDs overview. HoD identity is resolved via
 * faculty.department_id + the caller's role (roles.name = 'hod') - there is
 * no dedicated "department_hod" mapping table anywhere in the schema (see
 * prisma/seed.ts's note on faculty.department_id being the only column that
 * records a user's department). Placement% is "of students who applied to
 * at least one drive, % placed" - there's no stored "eligible/graduating"
 * flag to compute a whole-roster placement rate against.
 */
@Injectable()
export class PrincipalDepartmentsService {
  private readonly logger = new Logger(PrincipalDepartmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    try {
      // Run sequentially rather than via Promise.all - Supabase's session-mode
      // pooler caps concurrent connections quite low (pool_size: 15, shared
      // with all other app traffic), and firing 6 raw queries at once for a
      // single dashboard load risks tipping it over under any concurrent
      // load. This endpoint isn't latency-critical enough to be worth that
      // fragility.
      const departments = await this.prisma.departments.findMany({ orderBy: { name: 'asc' } });
      const hodRows = await this.prisma.$queryRaw<HodRow[]>(Prisma.sql`
        SELECT DISTINCT ON (f.department_id) f.department_id, f.first_name, f.last_name, f.designation
        FROM faculty f
        JOIN users u ON u.id = f.user_id
        JOIN roles r ON r.id = u.role_id
        WHERE r.name = 'hod' AND f.status = 'active'
        ORDER BY f.department_id, f.id ASC
      `);
      const studentRows = await this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT cl.department_id, COUNT(DISTINCT st.id)::bigint AS count
        FROM students st
        JOIN classes cl ON cl.id = st.class_id
        GROUP BY cl.department_id
      `);
      const facultyRows = await this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT department_id, COUNT(*)::bigint AS count
        FROM faculty
        WHERE status = 'active'
        GROUP BY department_id
      `);
      const attendanceRows = await this.prisma.$queryRaw<AttendanceRow[]>(Prisma.sql`
        WITH student_attendance AS (
          SELECT ar.student_id, cl.department_id,
            COUNT(*) FILTER (WHERE ar.status = 'present') AS present_count,
            COUNT(*) AS total_count
          FROM attendance_records ar
          JOIN students st2 ON st2.id = ar.student_id
          JOIN classes cl ON cl.id = st2.class_id
          WHERE ar.attendance_date = CURRENT_DATE
          GROUP BY ar.student_id, cl.department_id
        )
        SELECT department_id,
          AVG(present_count::numeric / NULLIF(total_count, 0) * 100)::text AS pct
        FROM student_attendance
        WHERE total_count > 0
        GROUP BY department_id
      `);
      const courseRows = await this.prisma.$queryRaw<CountRow[]>(Prisma.sql`
        SELECT department_id, COUNT(*)::bigint AS count
        FROM courses
        GROUP BY department_id
      `);
      const courseListRows = await this.prisma.courses.findMany({
        select: { id: true, department_id: true, name: true, code: true, duration_years: true },
        orderBy: { name: 'asc' },
      });
      const placementRows = await this.prisma.$queryRaw<PlacementRow[]>(Prisma.sql`
        WITH dept_students AS (
          SELECT st.id AS student_id, cl.department_id
          FROM students st
          JOIN classes cl ON cl.id = st.class_id
        )
        SELECT ds.department_id,
          COUNT(DISTINCT sda.student_id)::bigint AS applicants,
          COUNT(DISTINCT sda.student_id) FILTER (WHERE sda.status = 'placed')::bigint AS placed
        FROM student_drive_applications sda
        JOIN dept_students ds ON ds.student_id = sda.student_id
        GROUP BY ds.department_id
      `);

      const hodMap = new Map(hodRows.map((r) => [r.department_id, r]));
      const studentMap = new Map(studentRows.map((r) => [r.department_id, Number(r.count)]));
      const facultyMap = new Map(facultyRows.map((r) => [r.department_id, Number(r.count)]));
      const attendanceMap = new Map(
        attendanceRows.map((r) => [r.department_id, r.pct !== null ? Math.round(Number(r.pct) * 10) / 10 : null]),
      );
      const placementMap = new Map(placementRows.map((r) => [r.department_id, r]));
      const courseMap = new Map(courseRows.map((r) => [r.department_id, Number(r.count)]));
      const courseListMap = new Map<number, CourseRow[]>();
      for (const c of courseListRows) {
        const list = courseListMap.get(c.department_id) ?? [];
        list.push(c);
        courseListMap.set(c.department_id, list);
      }

      return {
        total_departments: departments.length,
        departments: departments.map((dept) => {
          const hod = hodMap.get(dept.id);
          const placement = placementMap.get(dept.id);
          const applicants = placement ? Number(placement.applicants) : 0;
          const placed = placement ? Number(placement.placed) : 0;

          return {
            id: dept.id,
            code: dept.code,
            name: dept.name,
            established_at: dept.created_at,
            courses_offered: courseMap.get(dept.id) ?? 0,
            courses: (courseListMap.get(dept.id) ?? []).map((c) => ({ id: c.id, name: c.name, code: c.code, duration_years: c.duration_years })),
            hod_name: hod ? `${hod.first_name} ${hod.last_name}`.trim() : null,
            students: studentMap.get(dept.id) ?? 0,
            faculty: facultyMap.get(dept.id) ?? 0,
            attendance_pct: attendanceMap.get(dept.id) ?? null,
            placement_pct: applicants > 0 ? Math.round((placed / applicants) * 1000) / 10 : null,
            placement_applicants: applicants,
          };
        }),
      };
    } catch (err) {
      this.logger.error('DB error computing principal departments & HoDs overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /principal-departments/class-mentors?department_id= — real
   * per-section mentor directory. `class_mentors` already models exactly
   * this (one mentor per class per academic_year) — it was previously
   * only ever queried for a faculty's OWN mentee classes; this exposes
   * the same real table institution-wide for the Students screen's
   * "Sections & representatives" panel.
   */
  async getClassMentors(departmentId?: number) {
    const classes = await this.prisma.classes.findMany({
      where: { department_id: departmentId },
      select: { id: true, section: true, current_semester: true },
    });
    const classIds = classes.map((c) => c.id);
    if (classIds.length === 0) return [];

    const mentors = await this.prisma.class_mentors.findMany({
      where: { class_id: { in: classIds } },
      orderBy: { academic_year: 'desc' },
      select: { class_id: true, academic_year: true, faculty: { select: { first_name: true, last_name: true } } },
    });
    const latestByClass = new Map<number, { first_name: string; last_name: string }>();
    for (const m of mentors) {
      if (!latestByClass.has(m.class_id)) latestByClass.set(m.class_id, m.faculty);
    }

    return classes.map((c) => ({
      class_id: c.id,
      section: c.section,
      semester: c.current_semester,
      mentor: latestByClass.has(c.id) ? `${latestByClass.get(c.id)!.first_name} ${latestByClass.get(c.id)!.last_name}` : null,
    }));
  }

  /**
   * GET /principal-departments/nba-status?department_id= — real
   * department-level NBA readiness %, aggregated from the same
   * nba_criteria/nba_evidence_items tables the Accreditation screen
   * already uses (no new table — just exposed at the department level too).
   */
  async getNbaStatus(departmentId?: number) {
    const criteria = await this.prisma.nba_criteria.findMany({
      where: { department_id: departmentId },
      select: { id: true, nba_evidence_items: { select: { done: true } } },
    });
    const total = criteria.reduce((s, c) => s + c.nba_evidence_items.length, 0);
    const done = criteria.reduce((s, c) => s + c.nba_evidence_items.filter((e) => e.done).length, 0);
    return {
      readiness_pct: total > 0 ? Math.round((done / total) * 100) : null,
      done_count: done,
      total_count: total,
      criteria_count: criteria.length,
    };
  }

  /**
   * GET /principal-departments/class-strength?department_id= — real
   * per-year/section student strength + attendance, computed from
   * students + attendance_records (same aggregate the Students screen's
   * section panel already computes client-side, exposed grouped by year too).
   */
  async getClassStrength(departmentId?: number) {
    const classes = await this.prisma.classes.findMany({
      where: { department_id: departmentId },
      select: { id: true, section: true, current_semester: true, batches: { select: { name: true } } },
    });
    const classIds = classes.map((c) => c.id);
    if (classIds.length === 0) return [];

    const [studentCounts, attendanceRows] = await Promise.all([
      this.prisma.students.groupBy({ by: ['class_id'], where: { class_id: { in: classIds } }, _count: { _all: true } }),
      this.prisma.attendance_records.groupBy({
        by: ['class_id', 'status'],
        where: { class_id: { in: classIds } },
        _count: { _all: true },
      }),
    ]);
    const countByClass = new Map(studentCounts.filter((c) => c.class_id !== null).map((c) => [c.class_id as number, c._count._all]));
    const attByClass = new Map<number, { present: number; total: number }>();
    for (const r of attendanceRows) {
      const entry = attByClass.get(r.class_id) ?? { present: 0, total: 0 };
      entry.total += r._count._all;
      if (r.status === 'present') entry.present += r._count._all;
      attByClass.set(r.class_id, entry);
    }

    return classes.map((c) => {
      const att = attByClass.get(c.id);
      return {
        class_id: c.id,
        section: c.section,
        semester: c.current_semester,
        batch: c.batches?.name ?? null,
        strength: countByClass.get(c.id) ?? 0,
        attendance_pct: att && att.total > 0 ? Math.round((att.present / att.total) * 1000) / 10 : null,
      };
    });
  }
}
