// results.service.ts
import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { UpdateResultDto } from './dto/update-result.dto';
import { ScheduleResultDto } from './dto/schedule-result.dto';

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
      return await this.prisma.result_publications.create({
        data: {
          exam_id: examId,
          publication_type: 'original',
          published_by_user_id: publishedByUserId,
        },
      });
    } catch (err: any) {
      this.logger.error('DB error while publishing results', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** Real department scope + candidate count for one exam — backs the Result Publication table's SCOPE column. Candidates come from exam_marks (works for every exam type) rather than exam_registrations, which only applies to University-registered exams and would read 0 for internal CIA cycles that still have real recorded marks. */
  /**
   * Batched replacement for the old per-row scopeForExam/withheldForExam
   * N+1 (was ~5 queries per result_publications row — see
   * docs/production/PERFORMANCE_AUDIT.md §2 row 1). Computes scope
   * (departments/candidates) and withheld (malpractice/dues) for every
   * distinct exam_id in `rows` with a fixed 5 queries total, regardless of
   * row count.
   */
  private async enrich<T extends { exam_id: number }>(rows: T[]) {
    if (rows.length === 0) return [];
    const examIds = [...new Set(rows.map((r) => r.exam_id))];

    const [
      totalDepartments,
      mappings,
      candidateRows,
      malpracticeRows,
      duesRows,
    ] = await Promise.all([
      this.prisma.departments.count(),
      this.prisma.exam_subject_mapping.findMany({
        where: { exam_id: { in: examIds } },
        select: {
          exam_id: true,
          classes: { select: { departments: { select: { code: true } } } },
        },
      }),
      this.prisma.$queryRaw<
        { exam_id: number; candidates: bigint }[]
      >(Prisma.sql`
          SELECT esm.exam_id, COUNT(DISTINCT em.student_id)::bigint AS candidates
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          WHERE esm.exam_id IN (${Prisma.join(examIds)}) AND em.is_absent = false
          GROUP BY esm.exam_id
        `),
      this.prisma.$queryRaw<
        { exam_id: number; malpractice: bigint }[]
      >(Prisma.sql`
          SELECT exam_id, COUNT(DISTINCT student_id)::bigint AS malpractice
          FROM malpractice_incidents
          WHERE exam_id IN (${Prisma.join(examIds)})
          GROUP BY exam_id
        `),
      this.prisma.$queryRaw<{ exam_id: number; dues: bigint }[]>(Prisma.sql`
          SELECT exam_id, COUNT(*)::bigint AS dues
          FROM exam_registrations
          WHERE exam_id IN (${Prisma.join(examIds)}) AND fee_status = 'unpaid'
          GROUP BY exam_id
        `),
    ]);

    const mappingsByExam = new Map<number, typeof mappings>();
    for (const m of mappings) {
      const list = mappingsByExam.get(m.exam_id) ?? [];
      list.push(m);
      mappingsByExam.set(m.exam_id, list);
    }
    const candidatesByExam = new Map(
      candidateRows.map((r) => [r.exam_id, Number(r.candidates)]),
    );
    const malpracticeByExam = new Map(
      malpracticeRows.map((r) => [r.exam_id, Number(r.malpractice)]),
    );
    const duesByExam = new Map(
      duesRows.map((r) => [r.exam_id, Number(r.dues)]),
    );

    return rows.map((r) => {
      const mappingsForExam = mappingsByExam.get(r.exam_id) ?? [];
      const departmentCodes = [
        ...new Set(
          mappingsForExam
            .map((m) => m.classes?.departments?.code)
            .filter((c): c is string => !!c),
        ),
      ].sort();
      const label =
        departmentCodes.length === 0
          ? '—'
          : departmentCodes.length >= totalDepartments
            ? 'All programmes'
            : departmentCodes.join(', ');
      const malpractice = malpracticeByExam.get(r.exam_id) ?? 0;
      const dues = duesByExam.get(r.exam_id) ?? 0;
      return {
        ...r,
        scope: {
          departments: departmentCodes,
          label,
          candidates: candidatesByExam.get(r.exam_id) ?? 0,
        },
        withheld: { malpractice, dues, total: malpractice + dues },
      };
    });
  }

  async findAll() {
    try {
      const rows = await this.prisma.result_publications.findMany({
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
        orderBy: { published_at: 'desc' },
      });

      const enriched = await this.enrich(rows);

      // Only the most recently published Live set can still be rolled back —
      // an older Live set has real downstream consequences (revaluation
      // windows, certificates) that make a straight rollback unsafe.
      const liveRowsDesc = enriched
        .filter((r) => r.state === 'live')
        .sort(
          (a, b) =>
            new Date(b.published_at).getTime() -
            new Date(a.published_at).getTime(),
        );
      const mostRecentLiveId = liveRowsDesc[0]?.id ?? null;

      return enriched.map((r) => ({
        ...r,
        can_rollback: r.state === 'live' && r.id === mostRecentLiveId,
      }));
    } catch (err: any) {
      this.logger.error('DB error while fetching results', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** Real KPI tiles for the Result Publication page header. */
  async getStats() {
    const rows = await this.findAll();

    const live = rows.filter((r) => r.state === 'live');
    const embargo = rows.filter((r) => r.state === 'embargo');
    const nearestEmbargoRelease =
      embargo
        .map((r) => r.scheduled_release_at)
        .filter((d): d is Date => d != null)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    return {
      sets_published: live.length,
      under_embargo: embargo.length,
      nearest_embargo_release: nearestEmbargoRelease,
      withheld_total: rows.reduce((s, r) => s + r.withheld.total, 0),
      withheld_malpractice: rows.reduce(
        (s, r) => s + r.withheld.malpractice,
        0,
      ),
      withheld_dues: rows.reduce((s, r) => s + r.withheld.dues, 0),
      candidates_covered: live.reduce((s, r) => s + r.scope.candidates, 0),
      live_set_count: live.length,
    };
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

  async schedule(id: number, dto: ScheduleResultDto) {
    const existing = await this.prisma.result_publications.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Result not found.',
        errorCode: 'RESULT_NOT_FOUND',
      });
    }

    return this.prisma.result_publications.update({
      where: { id },
      data: {
        scheduled_release_at: dto.scheduled_release_at
          ? new Date(dto.scheduled_release_at)
          : undefined,
        channels: dto.channels,
        state: dto.state,
      },
    });
  }

  /** A scheduled release genuinely goes live once its embargo time arrives, not just marked so — same real-dispatch pattern as coe_notification_broadcasts. */
  @Cron(CronExpression.EVERY_MINUTE)
  async releaseDueResults() {
    const due = await this.prisma.result_publications.findMany({
      where: { state: 'embargo', scheduled_release_at: { lte: new Date() } },
      select: { id: true },
    });
    for (const r of due) {
      try {
        await this.prisma.result_publications.update({
          where: { id: r.id },
          data: { state: 'live' },
        });
      } catch (err) {
        this.logger.error(
          `Failed to auto-release result publication ${r.id}`,
          err,
        );
      }
    }
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
}
