import { ConflictException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ApplyAppraisalDto } from './dto/apply-appraisal.dto';

/**
 * Staff appraisal — the real, pre-existing `appraisal_requests` /
 * `appraisal_entries` / `appraisal_criteria` / `appraisal_divisions` tables
 * (in schema.prisma). `appraisal_requests.staff_user_id` is the generic
 * non-teaching-staff column this needs — no new table. The criteria shown
 * are whatever the institution has actually published for the latest
 * academic_year (currently teaching-oriented, since no non-teaching set has
 * been added yet) — genuinely real data, not invented for this module.
 */
@Injectable()
export class MediaRoomAppraisalService {
  private readonly logger = new Logger(MediaRoomAppraisalService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findCriteria() {
    const rows = await this.prisma.appraisal_criteria.findMany({
      where: { status: 'active' },
      include: { appraisal_divisions: { select: { id: true, name: true } } },
      orderBy: [{ academic_year: 'desc' }, { division_id: 'asc' }, { id: 'asc' }],
    });
    if (rows.length === 0) return { academic_year: null, divisions: [] };

    const academicYear = rows[0].academic_year;
    const current = rows.filter((r) => r.academic_year === academicYear);
    const divisionsMap = new Map<number, { id: number; name: string; criteria: { id: number; name: string; max_score: number }[] }>();
    for (const r of current) {
      const division = divisionsMap.get(r.division_id) ?? { id: r.division_id, name: r.appraisal_divisions.name, criteria: [] };
      division.criteria.push({ id: r.id, name: r.criteria_name, max_score: Number(r.max_score) });
      divisionsMap.set(r.division_id, division);
    }
    return { academic_year: academicYear, divisions: [...divisionsMap.values()] };
  }

  async findHistory(userId: number) {
    try {
      const requests = await this.prisma.appraisal_requests.findMany({
        where: { staff_user_id: userId },
        include: { appraisal_entries: { include: { appraisal_criteria: { select: { id: true, criteria_name: true, max_score: true } } } } },
        orderBy: { created_at: 'desc' },
      });
      return {
        ready: true,
        data: requests.map((r) => ({
          id: r.id,
          academic_year: r.academic_year,
          status: r.status,
          management_approved_at: r.management_approved_at,
          created_at: r.created_at,
          entries: r.appraisal_entries.map((e) => ({
            id: e.id,
            description: e.description,
            score: e.score != null ? Number(e.score) : null,
            criteria: { id: e.appraisal_criteria.id, name: e.appraisal_criteria.criteria_name, max_score: Number(e.appraisal_criteria.max_score) },
          })),
        })),
      };
    } catch (err) {
      this.logger.error('DB error listing appraisal history', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async apply(dto: ApplyAppraisalDto, userId: number) {
    const existing = await this.prisma.appraisal_requests.findFirst({
      where: { staff_user_id: userId, academic_year: dto.academic_year },
    });
    if (existing) {
      throw new ConflictException({ message: 'An appraisal request already exists for this academic year', errorCode: 'APPRAISAL_ALREADY_SUBMITTED' });
    }

    try {
      const created = await this.prisma.appraisal_requests.create({
        data: {
          staff_user_id: userId,
          academic_year: dto.academic_year,
          appraisal_entries: { create: dto.entries.map((e) => ({ criteria_id: e.criteria_id, description: e.description })) },
        },
      });
      return { id: created.id };
    } catch (err) {
      this.logger.error('DB error creating appraisal request', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
