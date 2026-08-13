import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { ReportTable } from 'src/common/utils/report-export.util';

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/** classes.current_semester (1-based) -> year label, e.g. 3 or 4 -> "II". */
function yearLabelForSemester(semester: number): string {
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

/** soa_applications is nullable — students without a linked application fall back to their email, same convention used throughout the HOD module. */
function studentName(
  soa: { first_name: string; last_name: string | null } | null,
  email: string,
): string {
  if (!soa) return email;
  return (
    [soa.first_name, soa.last_name].filter(Boolean).join(' ').trim() || email
  );
}

@Injectable()
export class HodExaminationsService {
  constructor(private readonly prisma: PrismaService) {}

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

  /** GET /hod/examinations/filters — every class/batch/exam-type needed to drive the cascading filter bar. */
  async getFilters(userId: number) {
    const { department } = await this.resolveHodDepartment(userId);

    const [classes, examTypes] = await Promise.all([
      this.prisma.classes.findMany({
        where: {
          department_id: department.id,
          current_semester: { not: null },
        },
        select: {
          id: true,
          section: true,
          current_semester: true,
          batch_id: true,
          batches: {
            select: { id: true, name: true, start_year: true, end_year: true },
          },
        },
        orderBy: [
          { batch_id: 'asc' },
          { current_semester: 'asc' },
          { section: 'asc' },
        ],
      }),
      this.prisma.exam_types.findMany({
        select: { id: true, name: true, category: true },
        orderBy: { id: 'asc' },
      }),
    ]);

    const batchMap = new Map<number, { id: number; label: string }>();
    for (const c of classes) {
      if (!batchMap.has(c.batch_id)) {
        batchMap.set(c.batch_id, {
          id: c.batch_id,
          label: `${c.batches.start_year}-${c.batches.end_year}`,
        });
      }
    }

    return {
      department,
      batches: [...batchMap.values()],
      classes: classes.map((c) => ({
        class_id: c.id,
        batch_id: c.batch_id,
        semester: c.current_semester as number,
        year_label: yearLabelForSemester(c.current_semester as number),
        section: c.section,
      })),
      exam_types: examTypes.map((e) => ({
        id: e.id,
        name: e.name,
        category: e.category,
      })),
    };
  }

  private async loadGrid(userId: number, classId: number, examTypeId: number) {
    const { department } = await this.resolveHodDepartment(userId);

    const klass = await this.prisma.classes.findFirst({
      where: { id: classId, department_id: department.id },
      select: {
        id: true,
        section: true,
        current_semester: true,
        batch_id: true,
        batches: { select: { start_year: true, end_year: true } },
      },
    });
    if (!klass || klass.current_semester == null) {
      throw new NotFoundException('Class not found in this department');
    }

    const examType = await this.prisma.exam_types.findUnique({
      where: { id: examTypeId },
      select: { id: true, name: true },
    });
    if (!examType) {
      throw new NotFoundException('Examination type not found');
    }

    const context = {
      department,
      class: {
        id: klass.id,
        section: klass.section,
        semester: klass.current_semester,
        year_label: yearLabelForSemester(klass.current_semester),
        batch_label: `${klass.batches.start_year}-${klass.batches.end_year}`,
      },
      exam_type: examType,
    };

    const exam = await this.prisma.exams.findFirst({
      where: {
        exam_type_id: examTypeId,
        batch_id: klass.batch_id,
        semester: klass.current_semester,
      },
      select: { id: true },
      orderBy: { created_at: 'desc' },
    });

    const students = await this.prisma.students.findMany({
      where: { class_id: klass.id, status: 'active' },
      select: {
        id: true,
        student_id_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
      },
      orderBy: { student_id_no: 'asc' },
    });

    if (!exam) {
      return {
        ...context,
        candidates: students.length,
        papers: 0,
        subjects: [] as { id: number; code: string; name: string }[],
        rows: students.map((s) => ({
          student_id: s.id,
          register_no: s.student_id_no,
          name: studentName(s.soa_applications, s.users.email),
          marks: [] as (number | null)[],
          average_percent: null as number | null,
        })),
      };
    }

    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { exam_id: exam.id, class_id: klass.id },
      select: {
        id: true,
        subjects: { select: { id: true, name: true, subject_code: true } },
      },
      orderBy: { id: 'asc' },
    });

    const marks = await this.prisma.exam_marks.findMany({
      where: { exam_subject_mapping_id: { in: mappings.map((m) => m.id) } },
      select: {
        student_id: true,
        exam_subject_mapping_id: true,
        marks_obtained: true,
        max_marks: true,
        is_absent: true,
      },
    });

    const marksByStudent = new Map<
      number,
      Map<number, { obtained: number | null; max: number }>
    >();
    for (const mark of marks) {
      const byMapping =
        marksByStudent.get(mark.student_id) ??
        new Map<number, { obtained: number | null; max: number }>();
      byMapping.set(mark.exam_subject_mapping_id, {
        obtained:
          mark.is_absent || mark.marks_obtained == null
            ? mark.is_absent
              ? 0
              : null
            : Number(mark.marks_obtained),
        max: Number(mark.max_marks),
      });
      marksByStudent.set(mark.student_id, byMapping);
    }

    const rows = students.map((s) => {
      const byMapping = marksByStudent.get(s.id);
      let scoredSum = 0;
      let maxSum = 0;
      let anyGraded = false;
      const cellValues = mappings.map((m) => {
        const cell = byMapping?.get(m.id);
        if (!cell || cell.obtained == null) return null;
        scoredSum += cell.obtained;
        maxSum += cell.max;
        anyGraded = true;
        return cell.obtained;
      });
      return {
        student_id: s.id,
        register_no: s.student_id_no,
        name: studentName(s.soa_applications, s.users.email),
        marks: cellValues,
        average_percent:
          anyGraded && maxSum > 0
            ? Math.round((scoredSum / maxSum) * 1000) / 10
            : null,
      };
    });

    return {
      ...context,
      candidates: students.length,
      papers: mappings.length,
      subjects: mappings.map((m) => ({
        id: m.subjects.id,
        code: m.subjects.subject_code,
        name: m.subjects.name,
      })),
      rows,
    };
  }

  /** GET /hod/examinations/grid */
  async getGrid(userId: number, classId: number, examTypeId: number) {
    return this.loadGrid(userId, classId, examTypeId);
  }

  /** GET /hod/examinations/grid/export — same data, shaped for report-export.util's renderExcel. */
  async exportGrid(
    userId: number,
    classId: number,
    examTypeId: number,
  ): Promise<ReportTable> {
    const grid = await this.loadGrid(userId, classId, examTypeId);

    const columns = [
      { header: 'Register No.', key: 'register_no', width: 16 },
      { header: 'Candidate', key: 'name', width: 26 },
      ...grid.subjects.map((s) => ({
        header: s.code,
        key: `subject_${s.id}`,
        width: 12,
      })),
      { header: 'Average %', key: 'average_percent', width: 12 },
    ];

    const rows = grid.rows.map((r) => {
      const row: Record<string, unknown> = {
        register_no: r.register_no,
        name: r.name ?? '',
        average_percent: r.average_percent ?? '',
      };
      grid.subjects.forEach((s, i) => {
        row[`subject_${s.id}`] = r.marks[i] ?? '';
      });
      return row;
    });

    const title = `Examinations - ${grid.department.code} ${grid.class.year_label}-${grid.class.section} - ${grid.exam_type.name}`;
    return { title, columns, rows };
  }
}
