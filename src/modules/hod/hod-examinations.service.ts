import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

function yearLabel(semester: number | null): string {
  if (semester == null) return '—';
  return ['I', 'II', 'III', 'IV'][Math.ceil(semester / 2) - 1] ?? '—';
}

/**
 * GET /hod/examinations/filters and /hod/examinations/grid —
 * department-scoped exam results grid. Real tables: `classes`, `batches`,
 * `exam_types`, `exam_subject_mapping`, `exam_marks`, `subjects`, `students`.
 * Every query sequential — same Supabase pool-safety discipline as every
 * other hod service.
 */
@Injectable()
export class HodExaminationsService {
  private readonly logger = new Logger(HodExaminationsService.name);

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

  async getFilters(user: JwtPayload) {
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

      const classes = await this.prisma.classes.findMany({
        where: { department_id: departmentId },
        select: {
          id: true,
          batch_id: true,
          current_semester: true,
          section: true,
        },
        orderBy: [{ current_semester: 'asc' }, { section: 'asc' }],
      });
      const batchIds = [...new Set(classes.map((c) => c.batch_id))];
      const batches = batchIds.length
        ? await this.prisma.batches.findMany({
            where: { id: { in: batchIds } },
            select: { id: true, name: true },
          })
        : [];

      // Only exam types actually used by exams that touch this department's
      // classes — not the full institution-wide catalog.
      const usedExamTypeIds = await this.prisma.$queryRaw<
        { exam_type_id: number }[]
      >`
        SELECT DISTINCT e.exam_type_id
        FROM exams e
        JOIN exam_subject_mapping esm ON esm.exam_id = e.id
        JOIN classes cl ON cl.id = esm.class_id
        WHERE cl.department_id = ${departmentId}
      `;
      const examTypeIds = usedExamTypeIds.map((r) => r.exam_type_id);
      const examTypes = examTypeIds.length
        ? await this.prisma.exam_types.findMany({
            where: { id: { in: examTypeIds } },
            select: { id: true, name: true, category: true },
          })
        : [];

      return {
        department: {
          id: department.id,
          name: department.name,
          code: department.code,
        },
        batches: batches.map((b) => ({ id: b.id, label: b.name })),
        classes: classes.map((c) => ({
          class_id: c.id,
          batch_id: c.batch_id,
          semester: c.current_semester ?? 0,
          year_label: yearLabel(c.current_semester),
          section: c.section,
        })),
        exam_types: examTypes.map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
        })),
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD examination filters', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async getGrid(user: JwtPayload, classId: number, examTypeId: number) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const cls = await this.prisma.classes.findUnique({
        where: { id: classId },
        select: {
          id: true,
          section: true,
          current_semester: true,
          department_id: true,
          departments: { select: { id: true, name: true, code: true } },
          batches: { select: { name: true } },
        },
      });
      if (!cls || cls.department_id !== departmentId) {
        throw new NotFoundException({
          message: 'Class not found in your department.',
          errorCode: 'CLASS_NOT_FOUND',
        });
      }
      const examType = await this.prisma.exam_types.findUnique({
        where: { id: examTypeId },
        select: { id: true, name: true },
      });
      if (!examType) {
        throw new NotFoundException({
          message: 'Exam type not found.',
          errorCode: 'EXAM_TYPE_NOT_FOUND',
        });
      }

      // The specific exam (this class, this exam type) — most recent one if
      // several exist across academic years.
      const exam = await this.prisma.exams.findFirst({
        where: {
          exam_type_id: examTypeId,
          exam_subject_mapping: { some: { class_id: classId } },
        },
        orderBy: { created_at: 'desc' },
        select: { id: true },
      });

      const mappings = exam
        ? await this.prisma.exam_subject_mapping.findMany({
            where: { exam_id: exam.id, class_id: classId },
            select: {
              id: true,
              subjects: {
                select: { id: true, name: true, subject_code: true },
              },
            },
            orderBy: { subjects: { name: 'asc' } },
          })
        : [];

      const students = await this.prisma.students.findMany({
        where: { class_id: classId, status: 'active' },
        select: {
          id: true,
          register_no: true,
          soa_applications: { select: { first_name: true, last_name: true } },
        },
        orderBy: { register_no: 'asc' },
      });
      // Real display name comes from the student's original admission
      // application (soa_applications) — students itself has no name column.
      const nameByStudent = new Map(
        students.map((s) => [
          s.id,
          s.soa_applications
            ? `${s.soa_applications.first_name} ${s.soa_applications.last_name ?? ''}`.trim()
            : null,
        ]),
      );

      const marksRows = mappings.length
        ? await this.prisma.exam_marks.findMany({
            where: {
              exam_subject_mapping_id: { in: mappings.map((m) => m.id) },
            },
            select: {
              student_id: true,
              exam_subject_mapping_id: true,
              marks_obtained: true,
              max_marks: true,
              is_absent: true,
            },
          })
        : [];
      const marksByStudentMapping = new Map<string, number | null>();
      for (const m of marksRows) {
        const pct =
          !m.is_absent && m.marks_obtained != null && Number(m.max_marks) > 0
            ? Math.round(
                (Number(m.marks_obtained) / Number(m.max_marks)) * 1000,
              ) / 10
            : null;
        marksByStudentMapping.set(
          `${m.student_id}-${m.exam_subject_mapping_id}`,
          pct,
        );
      }

      const rows = students.map((s) => {
        const marks = mappings.map(
          (m) => marksByStudentMapping.get(`${s.id}-${m.id}`) ?? null,
        );
        const scored = marks.filter((v): v is number => v != null);
        return {
          student_id: s.id,
          register_no: s.register_no ?? '—',
          name: nameByStudent.get(s.id) ?? null,
          marks,
          average_percent:
            scored.length > 0
              ? Math.round(
                  (scored.reduce((a, b) => a + b, 0) / scored.length) * 10,
                ) / 10
              : null,
        };
      });

      return {
        department: {
          id: cls.departments.id,
          name: cls.departments.name,
          code: cls.departments.code,
        },
        class: {
          id: cls.id,
          section: cls.section,
          semester: cls.current_semester ?? 0,
          year_label: yearLabel(cls.current_semester),
          batch_label: cls.batches?.name ?? '—',
        },
        exam_type: { id: examType.id, name: examType.name },
        candidates: students.length,
        papers: mappings.length,
        subjects: mappings.map((m) => ({
          id: m.subjects.id,
          code: m.subjects.subject_code,
          name: m.subjects.name,
        })),
        rows,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD examination grid', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
