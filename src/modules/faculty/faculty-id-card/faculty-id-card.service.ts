import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

export interface FacultyIdCardStatus {
  issued: boolean;
  lastIssuedAt: Date | null;
  issueCount: number;
}

@Injectable()
export class FacultyIdCardService {
  private readonly logger = new Logger(FacultyIdCardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /faculty/:id/id-card (Admin). */
  async getStatus(facultyId: number): Promise<FacultyIdCardStatus> {
    await this.requireFaculty(facultyId);
    return this.buildStatus(facultyId);
  }

  /**
   * GET /faculty/id-card/status?faculty_ids=... (Admin) — powers the
   * bulk-issue preview, showing which of the selected faculty already have
   * a card on record before the admin confirms.
   */
  async getBulkStatus(
    facultyIds: number[],
  ): Promise<Record<number, FacultyIdCardStatus>> {
    const rows = await this.prisma.faculty_id_card_issuances.findMany({
      where: { faculty_id: { in: facultyIds } },
      orderBy: { issued_at: 'desc' },
      select: { faculty_id: true, issued_at: true },
    });

    const byFaculty = new Map<number, Date[]>();
    for (const row of rows) {
      const list = byFaculty.get(row.faculty_id) ?? [];
      list.push(row.issued_at);
      byFaculty.set(row.faculty_id, list);
    }

    const result: Record<number, FacultyIdCardStatus> = {};
    for (const id of facultyIds) {
      const entries = byFaculty.get(id) ?? [];
      result[id] = {
        issued: entries.length > 0,
        lastIssuedAt: entries[0] ?? null,
        issueCount: entries.length,
      };
    }
    return result;
  }

  /**
   * POST /faculty/:id/id-card/issue (Admin). Every call logs a new
   * issuance row rather than upserting a flag — a reissue (lost/damaged
   * card) stays on record alongside the original instead of overwriting it.
   * Also drops a line in the faculty's activity timeline for free, reusing
   * the existing faculty_activity_log table.
   */
  async issue(
    facultyId: number,
    actorUserId: number,
  ): Promise<FacultyIdCardStatus> {
    await this.requireFaculty(facultyId);

    await this.prisma.$transaction(async (tx) => {
      await tx.faculty_id_card_issuances.create({
        data: { faculty_id: facultyId, issued_by_user_id: actorUserId },
      });

      try {
        await tx.faculty_activity_log.create({
          data: {
            faculty_id: facultyId,
            description: 'ID card issued',
            created_by_user_id: actorUserId,
          },
        });
      } catch (err: unknown) {
        // Mirrors faculty.service.ts's logActivity — this table has been
        // flaky before; never let a timeline-logging failure block the
        // actual issuance that already committed above.
        this.logger.warn(`faculty_activity_log write skipped: ${String(err)}`);
      }
    });

    this.logger.log(
      `ID card issued: faculty_id=${facultyId} by user=${actorUserId}`,
    );
    return this.buildStatus(facultyId);
  }

  private async buildStatus(facultyId: number): Promise<FacultyIdCardStatus> {
    const [latest, issueCount] = await Promise.all([
      this.prisma.faculty_id_card_issuances.findFirst({
        where: { faculty_id: facultyId },
        orderBy: { issued_at: 'desc' },
        select: { issued_at: true },
      }),
      this.prisma.faculty_id_card_issuances.count({
        where: { faculty_id: facultyId },
      }),
    ]);

    return {
      issued: issueCount > 0,
      lastIssuedAt: latest?.issued_at ?? null,
      issueCount,
    };
  }

  private async requireFaculty(id: number): Promise<void> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException('Faculty not found');
    }
  }
}
