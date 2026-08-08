import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { exam_status_enum } from '../../../../../generated/prisma/enums';
import { GetExamResultsDto } from './dto/get-exam-results.dto';

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

type ExamGroup = {
  exam_id: number;
  title: string;
  isSemesterExam: boolean;
  ordinal: number;
  subjects: { subject_id: number; code: string; name: string; max: number; scored: number }[];
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

  private async computeExamResults(studentId: number, semester: number) {
    const marks = await this.fetchExamMarks(studentId, semester);

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
        max: Number(mark.max_marks),
        scored: mark.marks_obtained === null ? 0 : Number(mark.marks_obtained),
      });
    }

    const toResult = (group: ExamGroup) => ({
      exam_id: group.exam_id,
      number: group.ordinal,
      title: group.title,
      marks_obtained: round2(group.subjects.reduce((sum, s) => sum + s.scored, 0)),
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
              exams: { select: { id: true, exam_types: { select: { name: true } } } },
              subjects: { select: { id: true, name: true, subject_code: true } },
            },
          },
        },
      });
    } catch (err) {
      this.logger.error(`Failed to fetch exam results for student ${studentId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
