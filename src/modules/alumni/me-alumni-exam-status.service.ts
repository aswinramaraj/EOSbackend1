import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Whether an alumnus currently has a "standing arrear" — a subject whose
 * latest official (non-internal) exam attempt is still a fail. Graduation
 * (see AlumniGraduationService.graduateBatch) never deletes/reassigns the
 * original `students` row, so this reads the exact same exam_marks history
 * MeExamResultsService already reads for a current student, just resolved
 * for an alumni-role caller instead.
 *
 * Deliberately a leaner derivation than
 * student-exam-record.service.ts's computeExamResults (which additionally
 * folds internal marks into a combined total via regulation pass-mark
 * rules, for an admin/COE-facing full transcript) — this only needs a
 * single boolean to gate the alumni Campus tab's "Exam schedule" card, so
 * pass/fail is judged the same way the semester marksheet already does:
 * percentage against the real `grade_bands` table's `is_pass` flag.
 */
@Injectable()
export class MeAlumniExamStatusService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /me/alumni/arrears (Alumni only). */
  async getArrearStatus(userId: number) {
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

    const hasStandingArrear = await this.computeHasStandingArrear(student.id);
    return { hasStandingArrear };
  }

  private async computeHasStandingArrear(studentId: number): Promise<boolean> {
    const [marks, bands] = await Promise.all([
      this.prisma.exam_marks.findMany({
        where: {
          student_id: studentId,
          exam_subject_mapping: {
            exams: { exam_types: { category: { not: 'internal' } } },
          },
        },
        select: {
          marks_obtained: true,
          max_marks: true,
          is_absent: true,
          entered_at: true,
          exam_subject_mapping: { select: { subject_id: true } },
        },
      }),
      this.prisma.grade_bands.findMany({ orderBy: { display_order: 'asc' } }),
    ]);
    if (marks.length === 0) return false;

    // Latest official attempt per subject (by entered_at) — an earlier fail
    // that was later re-sat and passed (arrear/supplementary exam, or a
    // regular re-attempt) is no longer "standing", same rule
    // ArrearsService/StudentExamRecordService already use.
    const latestBySubject = new Map<
      number,
      { entered_at: Date; scored: number; max: number; isAbsent: boolean }
    >();
    for (const m of marks) {
      const subjectId = m.exam_subject_mapping.subject_id;
      const existing = latestBySubject.get(subjectId);
      if (!existing || m.entered_at > existing.entered_at) {
        latestBySubject.set(subjectId, {
          entered_at: m.entered_at,
          scored: m.marks_obtained === null ? 0 : Number(m.marks_obtained),
          max: Number(m.max_marks),
          isAbsent: m.is_absent,
        });
      }
    }

    for (const latest of latestBySubject.values()) {
      if (latest.isAbsent) return true;
      const percentage = latest.max > 0 ? (latest.scored / latest.max) * 100 : 0;
      const isPass = this.isPassAt(percentage, bands);
      if (!isPass) return true;
    }
    return false;
  }

  private isPassAt(
    percentage: number,
    bands: { min_percentage: unknown; is_pass: boolean }[],
  ): boolean {
    for (const b of bands) {
      if (percentage >= Number(b.min_percentage)) return b.is_pass;
    }
    return bands[bands.length - 1]?.is_pass ?? false;
  }
}
