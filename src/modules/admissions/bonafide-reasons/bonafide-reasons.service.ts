import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class BonafideReasonsService {
  private readonly logger = new Logger(BonafideReasonsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /bonafide-reasons
   *
   * Static reference list (id + reason_text) - no CRUD exists anywhere for
   * this table yet (the sibling /bonafide module is an unimplemented
   * NestJS-CLI stub for a different, unrelated resource). Public and
   * unguarded, matching the existing convention for reference-data lookups
   * used elsewhere (GET /exam-types, /exams, /exam-subject-mapping): the
   * list of valid reasons isn't sensitive, only which student requested
   * which reason is.
   */
  async findAll() {
    try {
      return await this.prisma.bonafide_reasons.findMany({
        orderBy: { reason_text: 'asc' },
      });
    } catch (err) {
      this.logger.error('DB error while fetching bonafide reasons', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
