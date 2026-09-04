import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

const ATTENDANCE_THRESHOLD_PERCENT = 75;

function yearLabel(semester: number | null): string | null {
  if (semester == null) return null;
  return ['I', 'II', 'III', 'IV'][Math.ceil(semester / 2) - 1] ?? null;
}

/** Same GRADE_LOOKUP formula as HodService/HodReportsService — copied verbatim, not reinvented. */
const GRADE_LOOKUP = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT is_pass, grade_point FROM grade_bands gb2
    WHERE gb2.min_percentage <= (CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)
    ORDER BY gb2.min_percentage DESC LIMIT 1
  ) gb ON true
`;

/**
 * GET /hod/class-records/classes — department-scoped class roster list.
 * Real tables only: `classes` (department_id), `students` (class_id) for
 * counts. Every query sequential — see HodService's own comments for why
 * Promise.all across raw DB calls is unsafe against Supabase's 15-connection
 * session-mode pool.
 */
@Injectable()
export class HodClassRecordsService {
  private readonly logger = new Logger(HodClassRecordsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

  async getClasses(user: JwtPayload) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const classes = await this.prisma.classes.findMany({
        where: { department_id: departmentId },
        select: { id: true, section: true, current_semester: true },
        orderBy: [{ current_semester: 'asc' }, { section: 'asc' }],
      });

      // One groupBy for every class's student count instead of one count()
      // round trip per class — same result, a single query regardless of how
      // many classes this department has.
      const counts = await this.prisma.students.groupBy({
        by: ['class_id'],
        where: { class_id: { in: classes.map((cl) => cl.id) }, status: 'active' },
        _count: { _all: true },
      });
      const countByClassId = new Map(counts.map((c) => [c.class_id, c._count._all]));

      return classes.map((cl) => ({
        class_id: cl.id,
        section: cl.section,
        year: yearLabel(cl.current_semester) ?? '—',
        semester: cl.current_semester ?? 0,
        student_count: countByClassId.get(cl.id) ?? 0,
      }));
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error listing HoD class records', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /hod/class-records/:classId — real class roster with per-student
   * academic/attendance/fee/placement standing. Every figure below is a
   * genuine aggregate over attendance_records/exam_marks/
   * student_drive_applications/student_fee_demand_mapping, grouped once
   * across the whole class rather than queried per student (still
   * sequential between each *different* stat — same pooler-capacity
   * discipline as every other hod service).
   */
  async getClassDetail(user: JwtPayload, classId: number) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const cls = await this.prisma.classes.findUnique({
        where: { id: classId },
        select: {
          id: true,
          section: true,
          current_semester: true,
          classroom: true,
          department_id: true,
          departments: { select: { name: true, code: true } },
        },
      });
      if (!cls || cls.department_id !== departmentId) {
        throw new NotFoundException({
          message: 'Class not found in your department.',
          errorCode: 'CLASS_NOT_FOUND',
        });
      }

      const students = await this.prisma.students.findMany({
        where: { class_id: classId, status: 'active' },
        select: {
          id: true,
          student_id_no: true,
          photo_url: true,
          soa_applications: { select: { first_name: true, last_name: true } },
        },
        orderBy: { student_id_no: 'asc' },
      });
      const studentIds = students.map((s) => s.id);
      const classLabel = `${yearLabel(cls.current_semester) ?? '—'}-${cls.section}`;

      const mentorRow = await this.prisma.class_mentors.findFirst({
        where: { class_id: classId },
        orderBy: { academic_year: 'desc' },
        select: {
          faculty: {
            select: {
              first_name: true,
              last_name: true,
              designation: true,
              users: { select: { email: true, phone: true } },
              departments: { select: { code: true } },
            },
          },
        },
      });

      if (studentIds.length === 0) {
        return {
          class: {
            class_id: cls.id,
            section: cls.section,
            semester: cls.current_semester,
            year: yearLabel(cls.current_semester),
            department_name: cls.departments.name,
            department_code: cls.departments.code,
            classroom: cls.classroom,
            student_count: 0,
          },
          advisor: mentorRow
            ? {
                name: `${mentorRow.faculty.first_name} ${mentorRow.faculty.last_name}`.trim(),
                designation: mentorRow.faculty.designation,
                department_code: mentorRow.faculty.departments.code,
                phone: mentorRow.faculty.users?.phone ?? null,
                email: mentorRow.faculty.users?.email ?? null,
              }
            : null,
          stats: null,
          students: [],
        };
      }

      // Attendance % per student — cumulative, all real attendance_records.
      const attendanceRows = await this.prisma.$queryRaw<
        { student_id: number; pct: string | null }[]
      >(Prisma.sql`
        SELECT student_id,
          (COUNT(*) FILTER (WHERE status = 'present')::numeric / NULLIF(COUNT(*), 0) * 100)::text AS pct
        FROM attendance_records
        WHERE student_id IN (${Prisma.join(studentIds)})
        GROUP BY student_id
      `);
      const attendanceByStudent = new Map(
        attendanceRows.map((r) => [
          r.student_id,
          r.pct != null ? Math.round(Number(r.pct) * 10) / 10 : null,
        ]),
      );

      // CGPA (cumulative) and current-semester GPA — same credit-weighted
      // formula as HodService's cgpaCte, computed per student in one pass.
      const gpaRows = await this.prisma.$queryRaw<
        { student_id: number; semester: number; gpa: string | null }[]
      >(Prisma.sql`
        SELECT em.student_id, e.semester,
          (SUM(gb.grade_point * COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL)
            / NULLIF(SUM(COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL), 0)) AS gpa
        FROM exam_marks em
        JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
        JOIN exams e ON e.id = esm.exam_id
        JOIN subjects sub ON sub.id = esm.subject_id
        ${GRADE_LOOKUP}
        WHERE e.status = 'results_published' AND em.is_absent = false AND em.marks_obtained IS NOT NULL
          AND em.student_id IN (${Prisma.join(studentIds)})
        GROUP BY em.student_id, e.semester
      `);
      const cgpaByStudent = new Map<number, number[]>();
      const currentSemGpaByStudent = new Map<number, number>();
      for (const row of gpaRows) {
        if (row.gpa == null) continue;
        const gpa = Number(row.gpa);
        const list = cgpaByStudent.get(row.student_id) ?? [];
        list.push(gpa);
        cgpaByStudent.set(row.student_id, list);
        if (row.semester === cls.current_semester) {
          currentSemGpaByStudent.set(row.student_id, gpa);
        }
      }

      // Arrears count per student — same subject_attempts pattern as
      // HodService's own arrears query, grouped per student instead of
      // just a department-wide count.
      const arrearsRows = await this.prisma.$queryRaw<
        { student_id: number; arrears: bigint }[]
      >(Prisma.sql`
        WITH subject_attempts AS (
          SELECT em.student_id, esm.subject_id, BOOL_OR(gb.is_pass) AS ever_passed
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          JOIN exams e ON e.id = esm.exam_id
          ${GRADE_LOOKUP}
          WHERE e.status = 'results_published' AND em.student_id IN (${Prisma.join(studentIds)})
          GROUP BY em.student_id, esm.subject_id
        )
        SELECT student_id, COUNT(*) FILTER (WHERE ever_passed IS NOT TRUE)::bigint AS arrears
        FROM subject_attempts GROUP BY student_id
      `);
      const arrearsByStudent = new Map(
        arrearsRows.map((r) => [r.student_id, Number(r.arrears)]),
      );

      // Placement status — real student_drive_applications, same 'placed'
      // enum value HodService's own placements query uses.
      const placedRows = await this.prisma.student_drive_applications.findMany({
        where: { student_id: { in: studentIds }, status: 'placed' },
        select: { student_id: true },
        distinct: ['student_id'],
      });
      const placedSet = new Set(placedRows.map((r) => r.student_id));

      // Fees — real student_fee_demand_mapping/fee_structure_items/
      // fee_payments, same tables NoDueService already uses; a plain
      // total-due sum per student (not the per-category breakdown that
      // service computes for its own dues screen).
      const feeRows = await this.prisma.student_fee_demand_mapping.findMany({
        where: { student_id: { in: studentIds } },
        select: {
          student_id: true,
          fee_structures: {
            select: {
              fee_structure_items: { select: { id: true, amount: true } },
            },
          },
          fee_payments: { select: { amount_paid: true } },
        },
      });
      const feeDueByStudent = new Map<number, number>();
      for (const row of feeRows) {
        const total = row.fee_structures.fee_structure_items.reduce(
          (sum, item) => sum + Number(item.amount),
          0,
        );
        const paid = row.fee_payments.reduce(
          (sum, p) => sum + Number(p.amount_paid),
          0,
        );
        feeDueByStudent.set(
          row.student_id,
          (feeDueByStudent.get(row.student_id) ?? 0) +
            Math.max(0, total - paid),
        );
      }

      const rows = students.map((s) => {
        const name = s.soa_applications
          ? `${s.soa_applications.first_name} ${s.soa_applications.last_name ?? ''}`.trim()
          : '—';
        const attendancePercent = attendanceByStudent.get(s.id) ?? null;
        const cgpaList = cgpaByStudent.get(s.id) ?? [];
        const cgpa =
          cgpaList.length > 0
            ? Math.round(
                (cgpaList.reduce((a, b) => a + b, 0) / cgpaList.length) * 100,
              ) / 100
            : null;
        const rawGpa = currentSemGpaByStudent.get(s.id);
        const gpa = rawGpa != null ? Math.round(rawGpa * 100) / 100 : null;
        const arrears = arrearsByStudent.get(s.id) ?? 0;
        const feeDue = feeDueByStudent.get(s.id) ?? 0;
        const isPlaced = placedSet.has(s.id);
        const atRisk =
          arrears > 0 ||
          (attendancePercent != null &&
            attendancePercent < ATTENDANCE_THRESHOLD_PERCENT);

        const flags: {
          label: string;
          tone: 'red' | 'amber' | 'green' | 'grey';
        }[] = [];
        if (
          attendancePercent != null &&
          attendancePercent < ATTENDANCE_THRESHOLD_PERCENT
        ) {
          flags.push({ label: 'Low attendance', tone: 'red' });
        }
        if (arrears > 0) {
          flags.push({
            label: `${arrears} arrear${arrears === 1 ? '' : 's'}`,
            tone: 'amber',
          });
        }
        if (feeDue > 0) {
          flags.push({ label: 'Fees due', tone: 'amber' });
        }
        if (isPlaced) {
          flags.push({ label: 'Placed', tone: 'green' });
        }

        return {
          student_id: s.id,
          student_id_no: s.student_id_no,
          name,
          photo_url: s.photo_url,
          class_label: classLabel,
          gpa,
          cgpa,
          arrears,
          attendance_percent: attendancePercent,
          fee_status: feeDue <= 0 ? ('paid' as const) : ('pending' as const),
          fee_due: feeDue,
          is_placed: isPlaced,
          at_risk: atRisk,
          flags,
        };
      });

      const attendanceValues = rows
        .map((r) => r.attendance_percent)
        .filter((v): v is number => v != null);
      const cgpaValues = rows
        .map((r) => r.cgpa)
        .filter((v): v is number => v != null);

      return {
        class: {
          class_id: cls.id,
          section: cls.section,
          semester: cls.current_semester,
          year: yearLabel(cls.current_semester),
          department_name: cls.departments.name,
          department_code: cls.departments.code,
          classroom: cls.classroom,
          student_count: students.length,
        },
        advisor: mentorRow
          ? {
              name: `${mentorRow.faculty.first_name} ${mentorRow.faculty.last_name}`.trim(),
              designation: mentorRow.faculty.designation,
              department_code: mentorRow.faculty.departments.code,
              phone: mentorRow.faculty.users?.phone ?? null,
              email: mentorRow.faculty.users?.email ?? null,
            }
          : null,
        stats: {
          mean_attendance:
            attendanceValues.length > 0
              ? Math.round(
                  (attendanceValues.reduce((a, b) => a + b, 0) /
                    attendanceValues.length) *
                    10,
                ) / 10
              : null,
          average_cgpa:
            cgpaValues.length > 0
              ? Math.round(
                  (cgpaValues.reduce((a, b) => a + b, 0) / cgpaValues.length) *
                    100,
                ) / 100
              : null,
          placed_count: rows.filter((r) => r.is_placed).length,
          eligible_count: rows.length,
          fees_pending_count: rows.filter((r) => r.fee_due > 0).length,
          student_count: rows.length,
        },
        students: rows,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD class detail', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
