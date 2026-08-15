import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { CreateApplicationWindowDto } from './dto/create-application-window.dto';

interface AspirantAppRow {
  admission_status: string | null;
  offer_status: string | null;
  application_submitted_date: Date | null;
  interview_date: Date | null;
}

interface WindowRow {
  id: number;
  university: string;
  country: string;
  intake: string | null;
  applicants_count: number;
  documents_pending: number;
  deadline: Date | null;
}

function windowLabel(deadline: Date | null, today: Date): string | null {
  if (!deadline) return null;
  const days = Math.round((deadline.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return 'Overdue';
  if (days === 0) return 'Today';
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * "Applications & deadlines" for the Higher Education Cell. KPIs (filed,
 * in evaluation, offers, interviews scheduled) stay derived from real
 * per-aspirant facts on student_higher_education, same as before. The
 * "Open application windows" table now comes from
 * higher_education_application_windows — a coordinator-maintained
 * register (new table) — since applicants/documents-pending/deadline are
 * typed-in fields on the design's own "Add application window" form, not
 * derivable from the one-row-per-aspirant schema. "Window" (days
 * remaining) is computed from deadline server-side rather than accepted as
 * a second manual field, so the two can never drift apart.
 */
@Injectable()
export class HigherEducationApplicationsService {
  private readonly logger = new Logger(HigherEducationApplicationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getApplications() {
    try {
      const aspirantRows = await this.prisma.$queryRaw<AspirantAppRow[]>(Prisma.sql`
        SELECT admission_status::text AS admission_status, offer_status::text AS offer_status, application_submitted_date, interview_date
        FROM student_higher_education
      `);

      const filed = aspirantRows.filter((r) => r.application_submitted_date != null);
      const inEvaluation = aspirantRows.filter((r) => r.admission_status === 'applied');
      const offersReceived = aspirantRows.filter((r) => r.offer_status === 'received' || r.offer_status === 'accepted');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const interviewsScheduled = aspirantRows.filter((r) => r.interview_date != null && r.interview_date >= today);

      const windowRows = await this.prisma.$queryRaw<WindowRow[]>(Prisma.sql`
        SELECT id, university, country, intake, applicants_count, documents_pending, deadline
        FROM higher_education_application_windows
        ORDER BY deadline ASC NULLS LAST, id ASC
      `);

      const fortnightFromNow = new Date(today);
      fortnightFromNow.setDate(fortnightFromNow.getDate() + 14);
      const closingSoon = windowRows.filter((r) => r.deadline != null && r.deadline >= today && r.deadline <= fortnightFromNow);
      const urgentThreshold = new Date(today);
      urgentThreshold.setDate(urgentThreshold.getDate() + 5);
      const urgentCount = closingSoon.filter((r) => r.deadline! <= urgentThreshold).length;

      return {
        kpis: {
          filed: filed.length,
          inEvaluation: inEvaluation.length,
          interviewsScheduled: interviewsScheduled.length,
          offersReceived: offersReceived.length,
          offerRatePercent: filed.length > 0 ? Math.round((offersReceived.length / filed.length) * 100) : null,
          closingWithin14Days: closingSoon.length,
          urgentCount,
        },
        windows: windowRows.map((r) => ({
          id: r.id,
          university: r.university,
          country: r.country,
          intake: r.intake,
          applicants: r.applicants_count,
          documentsPending: r.documents_pending,
          deadline: r.deadline ? r.deadline.toISOString().slice(0, 10) : null,
          window: windowLabel(r.deadline, today),
        })),
      };
    } catch (err) {
      this.logger.error('DB error building higher-education applications view', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async createApplicationWindow(dto: CreateApplicationWindowDto) {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
        INSERT INTO higher_education_application_windows (university, country, intake, applicants_count, documents_pending, deadline)
        VALUES (
          ${dto.university},
          ${dto.country},
          ${dto.intake ?? null},
          ${dto.applicants_count ?? 0},
          ${dto.documents_pending ?? 0},
          ${dto.deadline ?? null}
        )
        RETURNING id
      `);
      return { id: rows[0].id };
    } catch (err) {
      this.logger.error('DB error creating application window', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
