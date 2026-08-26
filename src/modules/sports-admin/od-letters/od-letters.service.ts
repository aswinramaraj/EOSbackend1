import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { INTERNAL_ERROR } from '../common/sports-common';
import { IssueOdLetterNumbersDto } from './dto/issue-od-letter-numbers.dto';

/**
 * "25-2026" style academic-year label: the year the current academic
 * session started (June onward counts as the new session) through the
 * following calendar year, matching the register's existing convention.
 */
function currentAcademicYearLabel(): string {
  const now = new Date();
  const year = now.getFullYear();
  const startYear = now.getMonth() + 1 >= 6 ? year : year - 1;
  return `${String(startYear).slice(-2)}-${startYear + 1}`;
}

/** Formats one issued row's serial id into the register's printed reference number. */
function formatLetterNumber(id: number): string {
  return `SECR/EXCU/SPORT/${String(id).padStart(3, '0')} ON DUTY LETER 1.O ${currentAcademicYearLabel()}`;
}

@Injectable()
export class OdLettersService {
  private readonly logger = new Logger(OdLettersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /sports-admin/od-letters/issue
   *
   * Issues one new, sequential letter number (sports_od_letter_numbers.id —
   * a real DB-generated SERIAL, never computed client-side) per student, all
   * in one transaction — mirrors how fee_receipt_numbers issues a receipt
   * number. The letter's actual text (event, venue, dates) is composed by
   * the caller from the OD letter form and the athlete's own profile; this
   * only logs that a number was issued, to whom, and by whom.
   */
  async issue(dto: IssueOdLetterNumbersDto, issuedByUserId: number) {
    const uniqueIds = [...new Set(dto.student_ids)];

    try {
      const rows = await this.prisma.$transaction(
        uniqueIds.map((studentId) =>
          this.prisma.sports_od_letter_numbers.create({
            data: { student_id: studentId, issued_by_user_id: issuedByUserId },
          }),
        ),
      );

      return rows.map((row) => ({
        student_id: row.student_id,
        letter_number: formatLetterNumber(row.id),
        issued_at: row.issued_at.toISOString(),
      }));
    } catch (err) {
      this.logger.error('DB error while issuing OD letter numbers', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
