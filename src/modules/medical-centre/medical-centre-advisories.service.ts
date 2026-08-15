import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma, announcement_category_enum } from '../../../generated/prisma/client';

const ADVISORY_INCLUDE = {
  users: { select: { email: true } },
} satisfies Prisma.announcementsInclude;

type AdvisoryWithRelations = Prisma.announcementsGetPayload<{ include: typeof ADVISORY_INCLUDE }>;

function toAdvisoryResponse(a: AdvisoryWithRelations) {
  return {
    id: a.id,
    tag: a.category ?? 'general',
    title: a.title,
    body: a.content,
    when: a.created_at.toISOString(),
    by: a.users.email,
  };
}

/**
 * Health advisories — reuses the shared `announcements` table, scoped to
 * posts made by the medical_centre role (same table the Dashboard's own
 * "Health advisories" panel already reads from).
 */
@Injectable()
export class MedicalCentreAdvisoriesService {
  private readonly logger = new Logger(MedicalCentreAdvisoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    try {
      const rows = await this.prisma.announcements.findMany({
        where: { users: { roles: { name: 'medical_centre' } } },
        include: ADVISORY_INCLUDE,
        orderBy: { created_at: 'desc' },
        take: 50,
      });
      return rows.map(toAdvisoryResponse);
    } catch (err) {
      this.logger.error('DB error listing health advisories', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async create(dto: { title: string; content: string; category?: announcement_category_enum }, userId: number) {
    try {
      const created = await this.prisma.announcements.create({
        data: {
          posted_by_user_id: userId,
          title: dto.title,
          content: dto.content,
          category: dto.category,
          target_audience: 'students',
          status: 'published',
        },
        include: ADVISORY_INCLUDE,
      });
      return toAdvisoryResponse(created);
    } catch (err) {
      this.logger.error('DB error creating health advisory', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
