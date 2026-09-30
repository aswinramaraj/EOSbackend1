import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { grade_bands } from 'generated/prisma/client';
import { isEndSemesterExam } from 'src/common/utils/exam-type.util';
import {
  computeSemesterAggregate,
  computeCumulativeAggregate,
  type SemesterAggregate,
} from 'src/common/utils/semester-gpa.util';

/**
 * Single place that writes `student_semester_gpa` — every SGPA/CGPA
 * consumer in this codebase used to compute its own version from scratch
 * (see docs/gpa_implementation_plan.md B.2/B.3); this is what replaces all
 * of them. Triggered by the two events that can actually change a result:
 * a real publish (ResultsService.publish) and an approved revaluation
 * (RevaluationService) — never computed speculatively on a read path.
 *
 * A semester "counts" toward SGPA/CGPA only when BOTH are true: the exam is
 * `results_published` AND it's a real end-semester exam
 * (isEndSemesterExam). The status check alone is not enough — live data
 * confirmed internal assessments (CIA/Quiz) can also carry
 * `results_published`, so skipping the exam-type check would silently
 * count 4-5 separate assessments per subject instead of the one that
 * actually represents the subject's grade.
 */
@Injectable()
export class GpaRecomputeService {
  private readonly logger = new Logger(GpaRecomputeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recomputes `fromSemester` for `studentId`, then cascades forward through
   * every later semester that already has any marks recorded — their
   * cumulative_credits/cumulative_weighted_points/cgpa all depend on
   * whatever changed in `fromSemester`. Safe to call for any single-mark
   * change (a publish or an approved revaluation) — it only touches this
   * one student's rows.
   */
  async recomputeForStudentFrom(
    studentId: number,
    fromSemester: number,
  ): Promise<void> {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { class_id: true },
    });
    if (!student?.class_id) return;

    const bands = await this.prisma.grade_bands.findMany({
      orderBy: { display_order: 'asc' },
    });

    const laterSemesterRows = await this.prisma.exam_marks.findMany({
      where: {
        student_id: studentId,
        exam_subject_mapping: { exams: { semester: { gte: fromSemester } } },
      },
      select: {
        exam_subject_mapping: {
          select: { exams: { select: { semester: true } } },
        },
      },
      distinct: ['exam_subject_mapping_id'],
    });
    const semesters = [
      ...new Set(
        laterSemesterRows.map((r) => r.exam_subject_mapping.exams.semester),
      ),
    ].sort((a, b) => a - b);
    if (semesters.length === 0) return;

    const priorRow = await this.prisma.student_semester_gpa.findFirst({
      where: { student_id: studentId, semester: { lt: fromSemester } },
      orderBy: { semester: 'desc' },
    });
    let cumulativeCredits = priorRow?.cumulative_credits ?? 0;
    let cumulativeWeightedPoints = priorRow
      ? Number(priorRow.cumulative_weighted_points)
      : 0;

    for (const semester of semesters) {
      const { aggregate, isProvisional } = await this.computeOneSemester(
        studentId,
        student.class_id,
        semester,
        bands,
      );

      const cumulative = computeCumulativeAggregate(
        cumulativeCredits,
        cumulativeWeightedPoints,
        aggregate,
      );
      cumulativeCredits = cumulative.cumulativeCredits;
      cumulativeWeightedPoints = cumulative.cumulativeWeightedPoints;

      await this.prisma.student_semester_gpa.upsert({
        where: { student_id_semester: { student_id: studentId, semester } },
        create: {
          student_id: studentId,
          semester,
          total_credits: aggregate.totalCredits,
          total_weighted_points: aggregate.totalWeightedPoints,
          sgpa: aggregate.sgpa ?? 0,
          cumulative_credits: cumulative.cumulativeCredits,
          cumulative_weighted_points: cumulative.cumulativeWeightedPoints,
          cgpa: cumulative.cgpa ?? 0,
          is_provisional: isProvisional,
        },
        update: {
          total_credits: aggregate.totalCredits,
          total_weighted_points: aggregate.totalWeightedPoints,
          sgpa: aggregate.sgpa ?? 0,
          cumulative_credits: cumulative.cumulativeCredits,
          cumulative_weighted_points: cumulative.cumulativeWeightedPoints,
          cgpa: cumulative.cgpa ?? 0,
          is_provisional: isProvisional,
          computed_at: new Date(),
        },
      });
    }

    this.logger.log(
      `Recomputed student_semester_gpa for student ${studentId}, semesters ${semesters.join(', ')}`,
    );
  }

  /** Full rebuild from this student's earliest semester — used by the backfill/reconciliation action. */
  async recomputeAllForStudent(studentId: number): Promise<void> {
    const earliest = await this.prisma.exam_marks.findFirst({
      where: { student_id: studentId },
      select: {
        exam_subject_mapping: {
          select: { exams: { select: { semester: true } } },
        },
      },
      orderBy: { exam_subject_mapping: { exams: { semester: 'asc' } } },
    });
    if (!earliest) return;
    await this.recomputeForStudentFrom(
      studentId,
      earliest.exam_subject_mapping.exams.semester,
    );
  }

  /**
   * `is_provisional` compares gradeable marks against every real subject
   * offered to this class in this semester (from exam_subject_mapping),
   * not just the marks that happen to exist yet — a semester with only 4
   * of 6 subjects published is provisional even though every mark that
   * does exist is individually gradeable.
   */
  private async computeOneSemester(
    studentId: number,
    classId: number,
    semester: number,
    bands: grade_bands[],
  ): Promise<{ aggregate: SemesterAggregate; isProvisional: boolean }> {
    const expectedMappings = await this.prisma.exam_subject_mapping.findMany({
      where: {
        class_id: classId,
        exams: { semester, exam_types: { category: 'external' } },
      },
      select: { id: true },
    });

    if (expectedMappings.length === 0) {
      return {
        aggregate: { totalCredits: 0, totalWeightedPoints: 0, sgpa: null },
        isProvisional: false,
      };
    }

    const marks = await this.prisma.exam_marks.findMany({
      where: {
        student_id: studentId,
        exam_subject_mapping_id: { in: expectedMappings.map((m) => m.id) },
      },
      select: {
        exam_subject_mapping_id: true,
        marks_obtained: true,
        max_marks: true,
        is_absent: true,
        exam_subject_mapping: {
          select: {
            subjects: { select: { credits: true } },
            exams: {
              select: {
                status: true,
                exam_types: { select: { category: true } },
              },
            },
          },
        },
      },
    });

    // A subject has a FINAL, known outcome once its exam is published and
    // either it has a real mark or it's officially absent — "absent" is not
    // "not graded yet", it's a final RA result (see grade_bands: RA/0 is a
    // real band, the same one a 0% score would resolve to). Only a subject
    // with no mark row at all yet (still ungraded) stays outside `known`,
    // which is what keeps `isProvisional` meaningful.
    const known = marks.filter(
      (m) =>
        m.exam_subject_mapping.exams.status === 'results_published' &&
        isEndSemesterExam(m.exam_subject_mapping.exams.exam_types) &&
        (m.is_absent || m.marks_obtained !== null),
    );

    const subjectResults = known.map((m) => ({
      credits: m.exam_subject_mapping.subjects.credits ?? 1,
      percentage: m.is_absent
        ? 0
        : (Number(m.marks_obtained) / Number(m.max_marks)) * 100,
    }));

    const aggregate = computeSemesterAggregate(subjectResults, bands);
    const isProvisional = known.length < expectedMappings.length;

    return { aggregate, isProvisional };
  }
}
