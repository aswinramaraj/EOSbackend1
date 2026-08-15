import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

interface CampRow {
  id: number;
  title: string;
  detail: string | null;
  camp_date: Date;
  state: string;
  target_count: number;
  registered_count: number;
  is_past: boolean;
  outcome_summary: string | null;
}

const STATE_LABEL: Record<string, string> = { running: 'Running', scheduled: 'Scheduled', planning: 'Planning' };

/** Camps & annual checkups — medical_camps (new table). */
@Injectable()
export class MedicalCentreCampsService {
  private readonly logger = new Logger(MedicalCentreCampsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    try {
      const rows = await this.prisma.$queryRaw<CampRow[]>(Prisma.sql`
        SELECT id, title, detail, camp_date, state, target_count, registered_count, is_past, outcome_summary
        FROM medical_camps ORDER BY camp_date ASC
      `);
      const upcoming = rows
        .filter((r) => !r.is_past)
        .map((r) => ({
          id: r.id,
          title: r.title,
          detail: r.detail ?? '—',
          date: r.camp_date.toISOString().slice(0, 10),
          state: STATE_LABEL[r.state] ?? r.state,
          done: r.registered_count,
          target: r.target_count,
        }));
      const past = rows
        .filter((r) => r.is_past)
        .map((r) => ({
          id: r.id,
          title: r.title,
          date: r.camp_date.toISOString().slice(0, 10),
          detail: r.detail ?? '—',
          done: r.registered_count,
          target: r.target_count,
          outcome: r.outcome_summary ?? '—',
        }));
      return { upcoming, past };
    } catch (err) {
      this.logger.error('DB error listing camps', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async registerBatch(id: number, count: number) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number; registered_count: number; target_count: number }[]>(Prisma.sql`
        UPDATE medical_camps SET registered_count = LEAST(target_count, registered_count + ${count})
        WHERE id = ${id} RETURNING id, registered_count, target_count
      `);
      if (rows.length === 0) throw new NotFoundException({ message: 'Camp not found', errorCode: 'CAMP_NOT_FOUND' });
      return { id, registered: rows[0].registered_count, target: rows[0].target_count };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(`DB error registering batch for camp ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
