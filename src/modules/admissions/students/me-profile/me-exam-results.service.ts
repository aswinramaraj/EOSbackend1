import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from 'generated/prisma/client';
import { exam_status_enum } from '../../../../../generated/prisma/enums';
import { GetExamResultsDto } from './dto/get-exam-results.dto';
import type { MarksheetData, MarksheetSubjectRow } from './marksheet-pdf.util';

/** Everything renderMarksheetPdf's header/info-block needs about the student — shared by getMyMarksheetData/getMarksheetDataForStudentId so both build the exact same MarksheetData shape. */
const MARKSHEET_STUDENT_SELECT = {
  id: true,
  register_no: true,
  date_of_birth: true,
  photo_url: true,
  classes: { select: { section: true, departments: { select: { name: true } } } },
  batches: { select: { start_year: true, end_year: true } },
  soa_applications: { select: { first_name: true, last_name: true } },
  users: { select: { email: true } },
} satisfies Prisma.studentsSelect;

// Exam lifecycle (see exam_status_enum): created -> timetable_published ->
// completed -> results_published. Marks aren't shown to the student until
// faculty have finished entering them - which in this schema is the
// "completed" status for every exam type. "results_published" additionally
// covers end-semester exams, which go through a separate COE publish step
// (POST /exams/:id/results/publish) after "completed".
const VISIBLE_EXAM_STATUSES: exam_status_enum[] = [
  exam_status_enum.completed,
  exam_status_enum.results_published,
];

// exam_types has no category column distinguishing "internal" from
// "end-semester" - the only signal available is the name (seeded as
// "Internal Assessment 1/2", "Model Examination", "End Semester
// Examination"). Anything not recognisably an end-semester/university exam
// is treated as an internal, which also covers "Model Examination" - the
// mobile app's UI only has two tabs (Internals / Semester exam).
function isSemesterExamType(examTypeName: string): boolean {
  const name = examTypeName.toLowerCase();
  return name.includes('end semester') || name.includes('university');
}

// Internal Assessment names end in a number ("Internal Assessment 2") which
// doubles as the display ordinal the mobile app expects (InternalResult.number).
// Falls back to insertion order for names without one (e.g. "Model Examination").
function extractOrdinal(examTypeName: string, fallback: number): number {
  const match = examTypeName.match(/(\d+)\s*$/);
  return match ? Number(match[1]) : fallback;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * departments.name embeds the degree prefix directly (e.g. "B.Tech
 * Artificial Intelligence and Data Science", "B.E. Computer Science and
 * Engineering" — confirmed via a live DB read: this college genuinely mixes
 * both prefixes across departments, it's not a uniform "every programme is
 * B.Tech" college) — a real marksheet shows these as two separate fields
 * ("Program: B.Tech." / "Branch: ARTIFICIAL INTELLIGENCE AND DATA SCIENCE"),
 * so this splits the one stored string back into both instead of hardcoding
 * either.
 */
function splitProgrammeAndBranch(departmentName: string): {
  programme: string;
  branch: string;
} {
  const match = departmentName.match(/^(B\.?\s*Tech\.?|B\.?\s*E\.?)\s+(.+)$/i);
  if (!match) return { programme: 'B.E.', branch: departmentName };
  const programme = /tech/i.test(match[1]) ? 'B.Tech.' : 'B.E.';
  return { programme, branch: match[2].trim() };
}

type SubjectFaculty = { id: number; first_name: string; last_name: string };

type ExamGroup = {
  exam_id: number;
  title: string;
  isSemesterExam: boolean;
  ordinal: number;
  subjects: {
    subject_id: number;
    code: string;
    name: string;
    credits: number | null;
    max: number;
    scored: number;
    faculty: SubjectFaculty | null;
  }[];
};

@Injectable()
export class MeExamResultsService {
  private readonly logger = new Logger(MeExamResultsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/exam-results?semester=
   *
   * Self-scoped: student_id resolved from the JWT. Groups the student's own
   * `exam_marks` (for the requested semester, restricted to exams whose
   * marks are actually visible yet - see VISIBLE_EXAM_STATUSES) into
   * "internals" (Internal Assessment / Model Examination) and a single
   * "semester_exam" (End Semester Examination), each with a subject-wise
   * breakdown - mirrors the shape the Student Performance screen renders.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND - authenticated user has no linked student record
   *  500 INTERNAL_ERROR    - unexpected DB failure
   */
  async getMyExamResults(userId: number, dto: GetExamResultsDto) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    return this.computeExamResults(student.id, dto.semester);
  }

  /**
   * Same computation as getMyExamResults, but for a student chosen by id
   * rather than resolved from the caller's own JWT - used by ParentsService
   * once it has verified (via parent_student_mapping) that the caller is
   * actually this student's parent.
   */
  async getExamResultsForStudentId(studentId: number, dto: GetExamResultsDto) {
    return this.computeExamResults(studentId, dto.semester);
  }

  /**
   * GET /me/exam-results/:semester/marksheet (self-scoped student_id from JWT).
   * Builds the data a PDF marksheet needs from the semester's END SEMESTER
   * exam only (the "Semester exam" tab, not internals) — matches what a real
   * paper marksheet reports. 404s (SEMESTER_EXAM_NOT_PUBLISHED) if that exam
   * hasn't had its results published yet, same as the Student Performance
   * screen just showing an empty "Semester exam" tab in that case.
   */
  async getMyMarksheetData(
    userId: number,
    semester: number,
  ): Promise<MarksheetData> {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: MARKSHEET_STUDENT_SELECT,
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    return this.buildMarksheetData(student, semester);
  }

  /** Same as getMyMarksheetData, but for a student chosen by id — used by ParentsService once it has verified (via parent_student_mapping) that the caller is actually this student's parent. */
  async getMarksheetDataForStudentId(
    studentId: number,
    semester: number,
  ): Promise<MarksheetData> {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: MARKSHEET_STUDENT_SELECT,
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    return this.buildMarksheetData(student, semester);
  }

  private async buildMarksheetData(
    student: Prisma.studentsGetPayload<{ select: typeof MARKSHEET_STUDENT_SELECT }>,
    semester: number,
  ): Promise<MarksheetData> {
    const { semester_exam } = await this.computeExamResults(
      student.id,
      semester,
    );
    if (!semester_exam) {
      throw new NotFoundException({
        message: 'Semester exam results have not been published yet',
        errorCode: 'SEMESTER_EXAM_NOT_PUBLISHED',
      });
    }

    const exam = await this.prisma.exams.findUnique({
      where: { id: semester_exam.exam_id },
      select: { academic_year: true },
    });

    // Same "regulation for this student's course" resolution as
    // student-exam-record.service.ts's own computeExamResults — regulations
    // has no direct FK to a student/class, only an intake_start_year that's
    // matched against the student's batch.
    const regulation = student.batches
      ? await this.prisma.regulations.findFirst({
          where: { intake_start_year: student.batches.start_year },
          select: { code: true },
        })
      : null;

    const bands = await this.prisma.grade_bands.findMany({
      orderBy: { display_order: 'asc' },
    });
    const gradeFor = (
      percentage: number,
    ): { label: string; point: number | null; isPass: boolean } => {
      for (const b of bands) {
        if (percentage >= Number(b.min_percentage)) {
          return {
            label: b.grade_label,
            point: b.grade_point === null ? null : Number(b.grade_point),
            isPass: b.is_pass,
          };
        }
      }
      const last = bands[bands.length - 1];
      return {
        label: last?.grade_label ?? 'U',
        point: last?.grade_point ? Number(last.grade_point) : null,
        isPass: last?.is_pass ?? false,
      };
    };

    const subjects: MarksheetSubjectRow[] = [];
    let totalCredits = 0;
    let earnedCredits = 0;
    let gradePointSum = 0;
    let gradePointCredits = 0;
    let allPass = true;

    for (const s of semester_exam.subjects) {
      const credits = s.credits ?? 0;
      const percentage = s.max > 0 ? (s.scored / s.max) * 100 : 0;
      const { label, point, isPass } = gradeFor(percentage);

      subjects.push({
        code: s.code,
        name: s.name,
        credits,
        max_marks: s.max,
        marks_obtained: s.scored,
        grade_label: label,
        grade_point: point,
        is_pass: isPass,
      });

      totalCredits += credits;
      if (isPass) earnedCredits += credits;
      else allPass = false;
      if (point !== null) {
        gradePointSum += point * credits;
        gradePointCredits += credits;
      }
    }

    const { programme, branch } = student.classes
      ? splitProgrammeAndBranch(student.classes.departments.name)
      : { programme: 'B.E.', branch: null };

    return {
      student_name: student.soa_applications
        ? [
            student.soa_applications.first_name,
            student.soa_applications.last_name,
          ]
            .filter(Boolean)
            .join(' ')
        : student.users.email,
      register_no: student.register_no,
      date_of_birth: student.date_of_birth
        ? student.date_of_birth.toISOString()
        : null,
      programme,
      department_name: branch,
      regulation_code: regulation?.code ?? null,
      batch_label: student.batches
        ? `${student.batches.start_year}-${student.batches.end_year}`
        : null,
      semester,
      academic_year: exam?.academic_year ?? null,
      exam_title: semester_exam.title,
      photo_url: student.photo_url,
      subjects,
      total_credits: totalCredits,
      earned_credits: earnedCredits,
      sgpa: gradePointCredits > 0 ? gradePointSum / gradePointCredits : null,
      overall_result: allPass ? 'PASS' : 'FAIL',
    };
  }

  private async computeExamResults(studentId: number, semester: number) {
    const marks = await this.fetchExamMarks(studentId, semester);
    const facultyBySubjectId = await this.fetchSubjectFaculty(
      studentId,
      marks.map((m) => m.exam_subject_mapping.subjects.id),
    );

    const groups = new Map<number, ExamGroup>();
    for (const mark of marks) {
      const exam = mark.exam_subject_mapping.exams;
      const subject = mark.exam_subject_mapping.subjects;
      const examType = exam.exam_types;

      let group = groups.get(exam.id);
      if (!group) {
        group = {
          exam_id: exam.id,
          title: examType.name,
          isSemesterExam: isSemesterExamType(examType.name),
          ordinal: extractOrdinal(examType.name, groups.size + 1),
          subjects: [],
        };
        groups.set(exam.id, group);
      }

      group.subjects.push({
        subject_id: subject.id,
        code: subject.subject_code,
        name: subject.name,
        credits: subject.credits,
        max: Number(mark.max_marks),
        scored: mark.marks_obtained === null ? 0 : Number(mark.marks_obtained),
        faculty: facultyBySubjectId.get(subject.id) ?? null,
      });
    }

    const toResult = (group: ExamGroup) => ({
      exam_id: group.exam_id,
      number: group.ordinal,
      title: group.title,
      marks_obtained: round2(
        group.subjects.reduce((sum, s) => sum + s.scored, 0),
      ),
      marks_total: round2(group.subjects.reduce((sum, s) => sum + s.max, 0)),
      subjects: group.subjects,
    });

    const allGroups = Array.from(groups.values());
    const internals = allGroups
      .filter((g) => !g.isSemesterExam)
      .sort((a, b) => a.ordinal - b.ordinal)
      .map(toResult);
    const semesterExam = allGroups.find((g) => g.isSemesterExam);

    return {
      semester,
      internals,
      semester_exam: semesterExam ? toResult(semesterExam) : null,
    };
  }

  /**
   * subject_id -> assigned faculty, resolved via faculty_subject_class_mapping
   * for this student's own class. Scoped to the class's most recent
   * academic_year row (same "latest academic_year" tiebreak used for a
   * faculty member's own current mapping elsewhere in this module) since the
   * mapping table has no separate "current academic year" column.
   */
  private async fetchSubjectFaculty(
    studentId: number,
    subjectIds: number[],
  ): Promise<Map<number, SubjectFaculty>> {
    const map = new Map<number, SubjectFaculty>();
    if (subjectIds.length === 0) return map;

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { class_id: true },
    });
    if (!student?.class_id) return map;

    const latest = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: { class_id: student.class_id },
      orderBy: { academic_year: 'desc' },
      select: { academic_year: true },
    });
    if (!latest) return map;

    const mappings = await this.prisma.faculty_subject_class_mapping.findMany({
      where: {
        class_id: student.class_id,
        academic_year: latest.academic_year,
        subject_id: { in: [...new Set(subjectIds)] },
      },
      select: {
        subject_id: true,
        faculty: { select: { id: true, first_name: true, last_name: true } },
      },
    });
    for (const m of mappings) map.set(m.subject_id, m.faculty);

    return map;
  }

  private async fetchExamMarks(studentId: number, semester: number) {
    try {
      return await this.prisma.exam_marks.findMany({
        where: {
          student_id: studentId,
          exam_subject_mapping: {
            exams: { semester, status: { in: VISIBLE_EXAM_STATUSES } },
          },
        },
        select: {
          marks_obtained: true,
          max_marks: true,
          exam_subject_mapping: {
            select: {
              exams: {
                select: { id: true, exam_types: { select: { name: true } } },
              },
              subjects: {
                select: { id: true, name: true, subject_code: true, credits: true },
              },
            },
          },
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to fetch exam results for student ${studentId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
