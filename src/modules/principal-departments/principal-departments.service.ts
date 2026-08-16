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
}
