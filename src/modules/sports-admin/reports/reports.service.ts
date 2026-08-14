import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { INTERNAL_ERROR } from '../common/sports-common';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { SearchReportsDto } from './dto/search-reports.dto';

const REPORT_INCLUDE = {
  users: { select: { id: true, email: true } },
} satisfies Prisma.sports_reportsInclude;

type ReportWithRelations = Prisma.sports_reportsGetPayload<{
  include: typeof REPORT_INCLUDE;
}>;

function toReportResponse(row: ReportWithRelations) {
  return {
    id: row.id,
    name: row.name,
    period_label: row.period_label,
    status: row.status,
    created_by: row.users ? { id: row.users.id, email: row.users.email } : null,
    updated_at: row.updated_at.toISOString(),
  };
}

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/reports?status= */
  async findAll(dto: SearchReportsDto) {
    const where: Prisma.sports_reportsWhereInput = {};
    if (dto.status) where.status = dto.status;

    try {
      const rows = await this.prisma.sports_reports.findMany({
        where,
        include: REPORT_INCLUDE,
        orderBy: { updated_at: 'desc' },
      });
      return rows.map(toReportResponse);
    } catch (err) {
      this.logger.error('DB error while fetching sports reports', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** POST /sports-admin/reports */
  async create(dto: CreateReportDto, userId: number) {
    try {
      const row = await this.prisma.sports_reports.create({
        data: {
          name: dto.name,
          period_label: dto.period_label,
          status: dto.status,
          created_by_user_id: userId,
        },
        include: REPORT_INCLUDE,
      });
      return toReportResponse(row);
    } catch (err) {
      this.logger.error('DB error while creating sports report', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * PATCH /sports-admin/reports/:id
   *
   * Error cases:
   *  404 REPORT_NOT_FOUND – no report with this id
   */
  async update(id: number, dto: UpdateReportDto) {
    await this.assertExists(id);

    try {
      const updated = await this.prisma.sports_reports.update({
        where: { id },
        data: {
          name: dto.name,
          period_label: dto.period_label,
          status: dto.status,
        },
        include: REPORT_INCLUDE,
      });
      return toReportResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating sports report', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/reports/:id
   *
   * Error cases:
   *  404 REPORT_NOT_FOUND – no report with this id
   */
  async remove(id: number) {
    await this.assertExists(id);

    try {
      await this.prisma.sports_reports.delete({ where: { id } });
      return { message: 'Report deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting sports report', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async assertExists(id: number) {
    let row: { id: number } | null;
    try {
      row = await this.prisma.sports_reports.findUnique({ where: { id } });
    } catch (err) {
      this.logger.error('DB error during sports report lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!row) {
      throw new NotFoundException({
        message: 'Report not found',
        errorCode: 'REPORT_NOT_FOUND',
      });
    }
  }
}
