import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

export interface StudentIdCardStatus {
  issued: boolean;
  lastIssuedAt: Date | null;
  issueCount: number;
}

const EMPTY_STATUS: StudentIdCardStatus = {
  issued: false,
  lastIssuedAt: null,
  issueCount: 0,
};

/**
 * Mirrors FacultyIdCardService exactly (see its own doc comment for the
 * reasoning behind logging every issuance as a new row rather than an
 * upsert) — the one real difference is that student_id_card_issuances is
 * proposed but not yet run against the live database (query.md #6), so
 * every query here is wrapped in try/catch the same way
 * StudentsService.listActivity already handles faculty_activity_log's own
 * intermittent-missing case: a missing table degrades to an honest "not
 * yet issued" / logged warning, never a 500, and needs no further code
 * changes once the table exists.
 */
@Injectable()
export class StudentIdCardService {
  private readonly logger = new Logger(StudentIdCardService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /students/id-card/status?student_ids=... (Admin) — bulk-issue preview. */
  async getBulkStatus(
    studentIds: number[],
  ): Promise<Record<number, StudentIdCardStatus>> {
    try {
      const rows = await this.prisma.student_id_card_issuances.findMany({
        where: { student_id: { in: studentIds } },
        orderBy: { issued_at: 'desc' },
        select: { student_id: true, issued_at: true },
      });

      const byStudent = new Map<number, Date[]>();
      for (const row of rows) {
        const list = byStudent.get(row.student_id) ?? [];
        list.push(row.issued_at);
        byStudent.set(row.student_id, list);
      }

      const result: Record<number, StudentIdCardStatus> = {};
      for (const id of studentIds) {
        const entries = byStudent.get(id) ?? [];
        result[id] = {
          issued: entries.length > 0,
          lastIssuedAt: entries[0] ?? null,
          issueCount: entries.length,
        };
      }
      return result;
    } catch (err: unknown) {
      this.logger.warn(
        `student_id_card_issuances unavailable (see query.md #6): ${String(err)}`,
      );
      return Object.fromEntries(studentIds.map((id) => [id, EMPTY_STATUS]));
    }
  }

  /** POST /students/:id/id-card/issue (Admin). */
  async issue(
    studentId: number,
    actorUserId: number,
  ): Promise<StudentIdCardStatus> {
    await this.requireStudent(studentId);

    try {
      await this.prisma.student_id_card_issuances.create({
        data: { student_id: studentId, issued_by_user_id: actorUserId },
      });
      this.logger.log(
        `ID card issued: student_id=${studentId} by user=${actorUserId}`,
      );
    } catch (err: unknown) {
      this.logger.error(
        `Could not issue student ID card — student_id_card_issuances may not exist yet (see query.md #6): ${String(err)}`,
      );
      throw new NotFoundException({
        message:
          "Student ID cards aren't enabled yet — ask an admin to run the pending database migration.",
        errorCode: 'ID_CARD_TABLE_UNAVAILABLE',
      });
    }

    return this.buildStatus(studentId);
  }

  private async buildStatus(studentId: number): Promise<StudentIdCardStatus> {
    try {
      const [latest, issueCount] = await Promise.all([
        this.prisma.student_id_card_issuances.findFirst({
          where: { student_id: studentId },
          orderBy: { issued_at: 'desc' },
          select: { issued_at: true },
        }),
        this.prisma.student_id_card_issuances.count({
          where: { student_id: studentId },
        }),
      ]);

      return {
        issued: issueCount > 0,
        lastIssuedAt: latest?.issued_at ?? null,
        issueCount,
      };
    } catch {
      return EMPTY_STATUS;
    }
  }

  private async requireStudent(id: number): Promise<void> {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException('Student not found');
    }
  }
}
