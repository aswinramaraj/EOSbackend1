import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { ReportTable } from 'src/common/utils/report-export.util';
import { toPercentage } from 'src/common/utils/marks.util';

function yearLabel(semester: number | null): string {
  if (semester == null) return '—';
  return ['I', 'II', 'III', 'IV'][Math.ceil(semester / 2) - 1] ?? '—';
}

/**
 * The class × exam-type marks grid — one paper-per-column table plus a
 * per-student average — shared by HoD's department-wide view
 * (HodExaminationsService, department-scoped) and Advisor's own-class view
 * (AdvisorExaminationsService, class_mentors-scoped). Neither caller's
 * authorization logic lives here: both resolve/validate `classId`
 * themselves (department ownership vs class-mentor ownership) before
 * calling in, so this stays a pure "given a class and exam type, build the
 * grid" builder with no role awareness of its own.
 */
@Injectable()
export class ExamResultsGridService {
  private readonly logger = new Logger(ExamResultsGridService.name);

  constructor(private readonly prisma: PrismaService) {}

  async buildGrid(classId: number, examTypeId: number) {
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
      if (!cls) {
        throw new NotFoundException({
          message: 'Class not found.',
          errorCode: 'CLASS_NOT_FOUND',
        });
      }
      const examType = await this.prisma.exam_types.findUnique({
        where: { id: examTypeId },
        select: { id: true, name: true, category: true },
      });
      if (!examType) {
        throw new NotFoundException({
          message: 'Exam type not found.',
          errorCode: 'EXAM_TYPE_NOT_FOUND',
        });
      }
      // University/external exams are graded, not scored — the mapping
      // owner (COE) never surfaces raw marks to faculty for these, only the
      // letter grade (see faculty/exam-marks assertInternalExam()).
      const isExternal = examType.category === 'external';
      const gradeBands = isExternal
        ? await this.prisma.grade_bands.findMany({
            orderBy: { min_percentage: 'desc' },
          })
        : [];
      const gradeForPercent = (pct: number | null): string | null => {
        if (pct == null) return null;
        const band = gradeBands.find((b) => pct >= Number(b.min_percentage));
        return band?.grade_label ?? null;
      };

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
        const pct = !m.is_absent
          ? toPercentage(
              m.marks_obtained != null ? Number(m.marks_obtained) : null,
              Number(m.max_marks),
            )
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
          grades: isExternal ? marks.map(gradeForPercent) : null,
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
        exam_type: {
          id: examType.id,
          name: examType.name,
          category: examType.category,
        },
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
      this.logger.error('DB error computing exam results grid', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** Same grid as buildGrid(), reshaped into the shared ReportTable the export utility expects. */
  async buildGridExportTable(
    classId: number,
    examTypeId: number,
  ): Promise<ReportTable> {
    const grid = await this.buildGrid(classId, examTypeId);

    const columns: ReportTable['columns'] = [
      { header: 'Register No.', key: 'register_no', width: 16 },
      { header: 'Candidate', key: 'name', width: 24 },
      ...grid.subjects.map((s) => ({
        header: s.code,
        key: `subject_${s.id}`,
        width: 12,
      })),
      { header: 'Average %', key: 'average_percent', width: 12 },
    ];

    const rows = grid.rows.map((row) => {
      const record: Record<string, unknown> = {
        register_no: row.register_no,
        name: row.name ?? '—',
        average_percent: row.average_percent ?? '—',
      };
      grid.subjects.forEach((s, i) => {
        record[`subject_${s.id}`] =
          (row.grades ? row.grades[i] : row.marks[i]) ?? '—';
      });
      return record;
    });

    const title = [
      grid.department.code,
      grid.class.batch_label,
      `Sem ${grid.class.semester}`,
      `Sec ${grid.class.section}`,
      grid.exam_type.name,
    ].join(' · ');

    return { title, columns, rows };
  }
}
