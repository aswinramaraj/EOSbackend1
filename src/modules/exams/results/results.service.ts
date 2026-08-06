// results.service.ts
import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateResultDto } from './dto/update-result.dto';

@Injectable()
export class ResultsService {
  private readonly logger = new Logger(ResultsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async publish(examId: number, publishedByUserId: number) {
    const exam = await this.prisma.exams.findUnique({ where: { id: examId } });

    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { exam_id: examId },
      select: { id: true },
    });

    if (mappings.length === 0) {
      throw new UnprocessableEntityException({
        message: 'Marks are incomplete for this exam.',
        errorCode: 'MARKS_INCOMPLETE',
      });
    }

    const mappingIds = mappings.map((m) => m.id);

    const markedMappings = await this.prisma.exam_marks.findMany({
      where: { exam_subject_mapping_id: { in: mappingIds } },
      select: { exam_subject_mapping_id: true },
      distinct: ['exam_subject_mapping_id'],
    });

    const markedMappingIds = new Set(
      markedMappings.map((m) => m.exam_subject_mapping_id),
    );

    const hasIncompleteMapping = mappingIds.some(
      (id) => !markedMappingIds.has(id),
    );

    if (hasIncompleteMapping) {
      throw new UnprocessableEntityException({
        message: 'Marks are incomplete for this exam.',
        errorCode: 'MARKS_INCOMPLETE',
      });
    }

    const existingPublication = await this.prisma.result_publications.findFirst(
      {
        where: { exam_id: examId, publication_type: 'original' },
      },
    );

    if (existingPublication) {
      throw new ConflictException({
        message: 'Results have already been published for this exam.',
        errorCode: 'ALREADY_PUBLISHED',
      });
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const publication = await tx.result_publications.create({
          data: {
            exam_id: examId,
            publication_type: 'original',
            published_by_user_id: publishedByUserId,
          },
        });

        await tx.exams.update({
          where: { id: examId },
          data: { status: 'results_published' },
        });

        return publication;
      });
    } catch (err: any) {
      this.logger.error('DB error while publishing results', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll() {
    try {
      return await this.prisma.result_publications.findMany({
        include: {
          exams: true,
          users: {
            select: {
              id: true,
              email: true,
              role_id: true,
              status: true,
            },
          },
        },
      });
    } catch (err: any) {
      this.logger.error('DB error while fetching results', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    let result: any;

    try {
      result = await this.prisma.result_publications.findUnique({
        where: { id },
        include: {
          exams: true,
          users: {
            select: {
              id: true,
              email: true,
              role_id: true,
              status: true,
            },
          },
        },
      });
    } catch (err: any) {
      this.logger.error('DB error while fetching result', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!result) {
      throw new NotFoundException({
        message: 'Result not found.',
        errorCode: 'RESULT_NOT_FOUND',
      });
    }

    return result;
  }

  async update(id: number, updateResultDto: UpdateResultDto) {
    const existing = await this.prisma.result_publications.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Result not found.',
        errorCode: 'RESULT_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.result_publications.update({
        where: { id },
        data: {
          publication_type: updateResultDto.publication_type,
          published_by_user_id: updateResultDto.published_by_user_id,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Result not found.',
          errorCode: 'RESULT_NOT_FOUND',
        });
      }

      this.logger.error('DB error while updating result', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
  // results.service.ts — add this method
  async remove(id: number) {
    const existing = await this.prisma.result_publications.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Result not found.',
        errorCode: 'RESULT_NOT_FOUND',
      });
    }

    try {
      await this.prisma.result_publications.delete({ where: { id } });
      return { id };
    } catch (err: any) {
      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Result not found.',
          errorCode: 'RESULT_NOT_FOUND',
        });
      }

      this.logger.error('DB error while deleting result', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /exams/:id/results/summary
   *
   * Pass/fail per paper is computed as percentage-of-max_marks vs
   * pass_mark_total (read as a percentage threshold) — this exam's own
   * marks only. It does NOT model combining a separate internal-assessment
   * exam's marks with this one into one subject total; that would need a
   * cross-exam join this endpoint's single-exam scope doesn't have.
   */
  async getSummary(examId: number) {
    await this.assertExamExists(examId);
    const passMarkTotal = await this.getPassMarkTotal();

    const marks = await this.prisma.exam_marks.findMany({
      where: { exam_subject_mapping: { exam_id: examId } },
      select: {
        marks_obtained: true,
        max_marks: true,
        is_absent: true,
        is_moderated: true,
      },
    });

    let passed = 0;
    let moderated = 0;
    let percentageSum = 0;

    for (const mark of marks) {
      if (mark.is_moderated) moderated++;
      const percentage = this.toPercentage(
        mark.marks_obtained,
        mark.max_marks,
        mark.is_absent,
      );
      percentageSum += percentage;
      if (!mark.is_absent && percentage >= passMarkTotal) passed++;
    }

    const total = marks.length;
    return {
      exam_id: examId,
      total_papers: total,
      pass_percentage: total > 0 ? this.round2((passed / total) * 100) : 0,
      average_percentage: total > 0 ? this.round2(percentageSum / total) : 0,
      arrears_count: total - passed,
      moderated_count: moderated,
    };
  }

  /** GET /exams/:id/results/pass-rate-by-department */
  async getPassRateByDepartment(examId: number) {
    await this.assertExamExists(examId);
    const passMarkTotal = await this.getPassMarkTotal();

    const marks = await this.prisma.exam_marks.findMany({
      where: { exam_subject_mapping: { exam_id: examId } },
      select: {
        marks_obtained: true,
        max_marks: true,
        is_absent: true,
        exam_subject_mapping: {
          select: {
            classes: {
              select: {
                departments: { select: { id: true, name: true, code: true } },
              },
            },
          },
        },
      },
    });

    const byDept = new Map<
      number,
      { name: string; code: string; total: number; passed: number }
    >();

    for (const mark of marks) {
      const dept = mark.exam_subject_mapping.classes.departments;
      const entry = byDept.get(dept.id) ?? {
        name: dept.name,
        code: dept.code,
        total: 0,
        passed: 0,
      };
      entry.total += 1;
      const percentage = this.toPercentage(
        mark.marks_obtained,
        mark.max_marks,
        mark.is_absent,
      );
      if (!mark.is_absent && percentage >= passMarkTotal) entry.passed += 1;
      byDept.set(dept.id, entry);
    }

    return [...byDept.entries()].map(([departmentId, entry]) => ({
      department_id: departmentId,
      department_name: entry.name,
      department_code: entry.code,
      total_papers: entry.total,
      pass_percentage:
        entry.total > 0 ? this.round2((entry.passed / entry.total) * 100) : 0,
    }));
  }

  /**
   * GET /exams/:id/results/rank-holders
   *
   * "current_exam_gpa" is a credit-weighted average of grade points across
   * this one exam's papers — explicitly NOT true CGPA, which needs
   * cross-semester history this schema doesn't track.
   */
  async getRankHolders(examId: number, limit: number) {
    await this.assertExamExists(examId);

    const gradeBands = await this.prisma.grade_bands.findMany({
      orderBy: { min_percentage: 'desc' },
    });

    const marks = await this.prisma.exam_marks.findMany({
      where: { exam_subject_mapping: { exam_id: examId } },
      select: {
        student_id: true,
        marks_obtained: true,
        max_marks: true,
        is_absent: true,
        students: {
          select: {
            id: true,
            student_id_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
          },
        },
        exam_subject_mapping: {
          select: { subjects: { select: { credits: true } } },
        },
      },
    });

    const byStudent = new Map<
      number,
      {
        credits: number;
        weightedPoints: number;
        student: (typeof marks)[number]['students'];
      }
    >();

    for (const mark of marks) {
      const percentage = this.toPercentage(
        mark.marks_obtained,
        mark.max_marks,
        mark.is_absent,
      );
      const gradePoint = this.gradePointFor(gradeBands, percentage);
      const credits = mark.exam_subject_mapping.subjects.credits ?? 1;

      const entry = byStudent.get(mark.student_id) ?? {
        credits: 0,
        weightedPoints: 0,
        student: mark.students,
      };
      entry.credits += credits;
      entry.weightedPoints += credits * gradePoint;
      byStudent.set(mark.student_id, entry);
    }

    return [...byStudent.entries()]
      .map(([studentId, entry]) => ({
        student_id: studentId,
        student_id_no: entry.student.student_id_no,
        name: this.resolveStudentName(entry.student),
        current_exam_gpa:
          entry.credits > 0
            ? this.round2(entry.weightedPoints / entry.credits)
            : 0,
      }))
      .sort((a, b) => b.current_exam_gpa - a.current_exam_gpa)
      .slice(0, limit);
  }

  private async assertExamExists(examId: number) {
    const exam = await this.prisma.exams.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }
  }

  private async getPassMarkTotal(): Promise<number> {
    const rules = await this.prisma.exam_pass_rules_settings.findFirst();
    return rules ? Number(rules.pass_mark_total) : 50;
  }

  private toPercentage(
    marksObtained: unknown,
    maxMarks: unknown,
    isAbsent: boolean,
  ): number {
    if (isAbsent) return 0;
    const max = Number(maxMarks);
    if (max <= 0) return 0;
    return (Number(marksObtained ?? 0) / max) * 100;
  }

  private gradePointFor(
    gradeBands: { min_percentage: unknown; grade_point: unknown }[],
    percentage: number,
  ): number {
    const band = gradeBands.find((b) => percentage >= Number(b.min_percentage));
    return band?.grade_point !== null && band?.grade_point !== undefined
      ? Number(band.grade_point)
      : 0;
  }

  private resolveStudentName(student: {
    soa_applications: { first_name: string; last_name: string | null } | null;
    users: { email: string };
  }): string {
    if (student.soa_applications) {
      const { first_name, last_name } = student.soa_applications;
      return last_name ? `${first_name} ${last_name}` : first_name;
    }
    return student.users.email;
  }

  private round2(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
