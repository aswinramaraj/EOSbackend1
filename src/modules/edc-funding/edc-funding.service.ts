import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateFundingRecordDto } from './dto/create-funding-record.dto';
import { UpdateFundingRecordDto } from './dto/update-funding-record.dto';

const INCLUDE = {
  student_entrepreneurship: { select: { id: true, business_name: true } },
} as const;

/**
 * EDC Coordinator's "Funding" screen — real `edc_funding_records` table,
 * added this session specifically to match the design's per-disbursement
 * layout (KPI cards by source category, a Distribution panel, a
 * Utilisation panel, a Funding Records table) — the flat
 * funding_received/funding_source/funding_status columns already on
 * student_entrepreneurship could only support ONE number per venture, with
 * no utilisation tracking at all, so they couldn't honestly back this
 * design without a new table (confirmed via the live DB audit before this
 * was proposed).
 */
@Injectable()
export class EdcFundingService {
  private readonly logger = new Logger(EdcFundingService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toResponse(row: any) {
    return {
      id: row.id,
      student_entrepreneurship_id: row.student_entrepreneurship_id,
      venture_name: row.student_entrepreneurship?.business_name ?? null,
      source_category: row.source_category,
      source_detail: row.source_detail,
      amount: Number(row.amount),
      disbursed_date: row.disbursed_date,
      utilisation_pct: row.utilisation_pct,
      status: row.status,
      created_at: row.created_at,
    };
  }

  async findAll() {
    try {
      const rows = await this.prisma.edc_funding_records.findMany({
        include: INCLUDE,
        orderBy: { disbursed_date: 'desc' },
      });
      return rows.map((row) => this.toResponse(row));
    } catch (err) {
      this.logger.error('DB error listing edc_funding_records', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  /** KPI tiles + Distribution/Utilisation panels — all computed live. */
  async stats() {
    const rows = await this.prisma.edc_funding_records.findMany({
      select: { source_category: true, amount: true, utilisation_pct: true, status: true },
    });

    const total = rows.reduce((sum, r) => sum + Number(r.amount), 0);
    const byCategory = (cat: string) => rows.filter((r) => r.source_category === cat).reduce((sum, r) => sum + Number(r.amount), 0);

    const distribution = ['College grant', 'Competition prize', 'External investment', 'Government grant'].map((cat) => ({
      category: cat,
      count: rows.filter((r) => r.source_category === cat).length,
    }));

    const utilised = rows.reduce((sum, r) => sum + Number(r.amount) * (r.utilisation_pct / 100), 0);
    const committed = rows.filter((r) => r.status === 'In Progress').reduce((sum, r) => sum + Number(r.amount) * (1 - r.utilisation_pct / 100), 0);
    const unreported = rows.filter((r) => r.status === 'Pending').reduce((sum, r) => sum + Number(r.amount) * (1 - r.utilisation_pct / 100), 0);
    const round2 = (n: number) => Math.round(n * 100) / 100;

    return {
      total_funding: total,
      college_grant: byCategory('College grant'),
      competition_prize: byCategory('Competition prize'),
      external_investment: byCategory('External investment'),
      disbursement_count: rows.length,
      distribution,
      utilisation: { utilised: round2(utilised), committed: round2(committed), unreported: round2(unreported) },
    };
  }

  async create(dto: CreateFundingRecordDto, createdByUserId: number) {
    const venture = await this.prisma.student_entrepreneurship.findUnique({ where: { id: dto.student_entrepreneurship_id } });
    if (!venture) {
      throw new NotFoundException({ message: 'Venture not found', errorCode: 'VENTURE_NOT_FOUND' });
    }
    try {
      const created = await this.prisma.edc_funding_records.create({
        data: {
          student_entrepreneurship_id: dto.student_entrepreneurship_id,
          source_category: dto.source_category,
          source_detail: dto.source_detail,
          amount: dto.amount,
          disbursed_date: new Date(dto.disbursed_date),
          utilisation_pct: dto.utilisation_pct,
          status: dto.status,
          created_by_user_id: createdByUserId,
        },
        include: INCLUDE,
      });
      return this.toResponse(created);
    } catch (err) {
      this.logger.error('DB error creating edc_funding_record', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async update(id: number, dto: UpdateFundingRecordDto) {
    const existing = await this.prisma.edc_funding_records.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Funding record not found', errorCode: 'FUNDING_RECORD_NOT_FOUND' });
    }
    try {
      const updated = await this.prisma.edc_funding_records.update({
        where: { id },
        data: {
          source_category: dto.source_category,
          source_detail: dto.source_detail,
          amount: dto.amount,
          disbursed_date: dto.disbursed_date ? new Date(dto.disbursed_date) : undefined,
          utilisation_pct: dto.utilisation_pct,
          status: dto.status,
        },
        include: INCLUDE,
      });
      return this.toResponse(updated);
    } catch (err) {
      this.logger.error('DB error updating edc_funding_record', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async remove(id: number) {
    const existing = await this.prisma.edc_funding_records.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Funding record not found', errorCode: 'FUNDING_RECORD_NOT_FOUND' });
    }
    await this.prisma.edc_funding_records.delete({ where: { id } });
    return { id, deleted: true };
  }
}
