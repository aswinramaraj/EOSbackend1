import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * `coe_profiles` is a singleton-per-user table that already existed with
 * zero reads/writes anywhere. Lazily creates a (non-senior) row on first
 * read, same convention as exam_pass_rules_settings.findOne().
 */
@Injectable()
export class CoeProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getMine(userId: number) {
    const existing = await this.prisma.coe_profiles.findUnique({ where: { user_id: userId } });
    if (existing) return existing;
    return this.prisma.coe_profiles.create({ data: { user_id: userId } });
  }
}
