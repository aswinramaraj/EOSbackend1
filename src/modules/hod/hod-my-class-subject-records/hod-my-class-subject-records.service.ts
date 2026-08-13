import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { percentageToGrade } from '../shared/grade-scale.util';

interface HandledClass {
  class_id: number;
  subject_id: number;
  section: string;
  semester: number | null;
  subject_name: string;
  subject_code: string;
}

@Injectable()
export class HodMyClassSubjectRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveFaculty(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  /** One row per (class, subject) the caller personally teaches, deduped across academic_year re-mappings (most recent wins). */
  private async getHandledClasses(facultyId: number): Promise<HandledClass[]> {
    const mappings = await this.prisma.faculty_subject_class_mapping.findMany({
      where: { faculty_id: facultyId },
      select: {
        class_id: true,
        subject_id: true,
        classes: { select: { section: true, current_semester: true } },
        subjects: { select: { name: true, subject_code: true } },
      },
      orderBy: [
        { academic_year: 'desc' },
        { class_id: 'asc' },
        { subject_id: 'asc' },
      ],
    });

    const seen = new Set<string>();
    return mappings
      .filter((m) => {
        const key = `${m.class_id}-${m.subject_id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((m) => ({
        class_id: m.class_id,
        subject_id: m.subject_id,
        section: m.classes.section,
        semester: m.classes.current_semester,
        subject_name: m.subjects.name,
        subject_code: m.subjects.subject_code,
      }));
  }

  /**
   * GET /hod/my-class/subject-records?class_id=&subject_id=&semester=
   * Columns are derived entirely from real data — every internal-category
   * exam_subject_mapping actually recorded for the selected class+subject —
   * rather than a hardcoded "Internal 1/Internal 2/Quiz/Presentation" set,
   * since which/how-many internal assessments exist varies by subject.
   */
  async getOverview(
    userId: number,
    classId?: number,
    subjectId?: number,
    semester?: number,
  ) {
    const faculty = await this.resolveFaculty(userId);
    const handledClasses = await this.getHandledClasses(faculty.id);

    if (handledClasses.length === 0) {
      return {
        handled_classes: [],
        selected_class: null,
        semesters: [],
        selected_semester: null,
        columns: [],
        students: [],
        student_count: 0,
      };
    }

    const selectedClass =
      (classId != null && subjectId != null
        ? handledClasses.find(
            (h) => h.class_id === classId && h.subject_id === subjectId,
          )
        : undefined) ?? handledClasses[0];

    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: {
        class_id: selectedClass.class_id,
        subject_id: selectedClass.subject_id,
        exams: { exam_types: { category: 'internal' } },
      },
      select: {
        id: true,
        exams: {
          select: {
            semester: true,
            title: true,
            start_date: true,
            exam_types: { select: { name: true } },
          },
        },
        exam_marks: {
          select: {
            student_id: true,
            marks_obtained: true,
            max_marks: true,
            is_absent: true,
          },
        },
      },
      orderBy: { exams: { start_date: 'asc' } },
    });

    const semesters = [...new Set(mappings.map((m) => m.exams.semester))].sort(
      (a, b) => a - b,
    );
    const selectedSemester =
      semester != null && semesters.includes(semester)
        ? semester
        : (semesters[semesters.length - 1] ?? null);

    const semesterMappings = mappings.filter(
      (m) => m.exams.semester === selectedSemester,
    );

    // Labelled by the shared exam_type name (short, reusable — e.g. "Internal
    // Assessment", "Quiz"), numbered only when more than one exam of that
    // same type exists this semester — not by each exam's own `title`, which
    // tends to be a long per-instance string (e.g. "Internal Assessment I -
    // Semester 1") that reads fine as a record's own title but breaks the
    // table header layout when reused verbatim as a short column label.
    const typeCounts = new Map<string, number>();
    for (const m of semesterMappings) {
      const key = m.exams.exam_types.name;
      typeCounts.set(key, (typeCounts.get(key) ?? 0) + 1);
    }
    const typeOrdinal = new Map<string, number>();
    const columns = semesterMappings.map((m) => {
      const typeName = m.exams.exam_types.name;
      let label = typeName;
      if ((typeCounts.get(typeName) ?? 1) > 1) {
        const ordinal = (typeOrdinal.get(typeName) ?? 0) + 1;
        typeOrdinal.set(typeName, ordinal);
        label = `${typeName} ${ordinal}`;
      }
      const maxMarksRow = m.exam_marks.find((em) => em.max_marks != null);
      return {
        mapping_id: m.id,
        label,
        max_marks: maxMarksRow ? Number(maxMarksRow.max_marks) : null,
      };
    });

    const students = await this.prisma.students.findMany({
      where: { class_id: selectedClass.class_id, status: 'active' },
      select: {
        id: true,
        student_id_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
      },
      orderBy: { student_id_no: 'asc' },
    });

    const marksByKey = new Map<
      string,
      { marks_obtained: unknown; is_absent: boolean }
    >();
    for (const m of semesterMappings) {
      for (const em of m.exam_marks) {
        marksByKey.set(`${em.student_id}-${m.id}`, em);
      }
    }

    const rows = students.map((s) => {
      const cells = columns.map((col) => {
        const em = marksByKey.get(`${s.id}-${col.mapping_id}`);
        return {
          mapping_id: col.mapping_id,
          marks_obtained:
            em?.marks_obtained != null ? Number(em.marks_obtained) : null,
          is_absent: em?.is_absent ?? false,
        };
      });

      let totalObtained = 0;
      let totalMax = 0;
      cells.forEach((c, i) => {
        if (c.marks_obtained != null && !c.is_absent) {
          totalObtained += c.marks_obtained;
          totalMax += columns[i].max_marks ?? 0;
        }
      });
      const percentage = totalMax > 0 ? (totalObtained / totalMax) * 100 : null;

      return {
        student_id: s.id,
        student_id_no: s.student_id_no,
        // students has no name columns of its own — soa_applications is the
        // only source, and isn't populated for every student (e.g. never
        // completed admissions). Falls back to email rather than an empty
        // bold name line, matching the same fallback already used for this
        // exact gap elsewhere (assignments.service.ts, student-assignment-
        // status.service.ts's own resolveStudentName()).
        name: s.soa_applications
          ? [s.soa_applications.first_name, s.soa_applications.last_name]
              .filter(Boolean)
              .join(' ')
          : s.users.email,
        email: s.users.email,
        cells,
        grade: percentage != null ? percentageToGrade(percentage).grade : null,
      };
    });

    const columnsWithAverage = columns.map((col, i) => {
      const values = rows
        .map((r) => r.cells[i])
        .filter((c) => c.marks_obtained != null && !c.is_absent)
        .map((c) => c.marks_obtained as number);
      const average =
        values.length > 0
          ? Math.round(
              (values.reduce((a, b) => a + b, 0) / values.length) * 10,
            ) / 10
          : null;
      return { ...col, average };
    });

    return {
      handled_classes: handledClasses,
      selected_class: selectedClass,
      semesters,
      selected_semester: selectedSemester,
      columns: columnsWithAverage,
      students: rows,
      student_count: rows.length,
    };
  }
}
