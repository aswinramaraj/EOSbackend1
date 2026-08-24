import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdatePassRulesDto } from './dto/update-pass-rules.dto';

/**
 * `exam_pass_rules_settings` is a singleton table — exactly one row is
 * expected. findOne lazily creates the default row if the table is
 * genuinely empty, so this endpoint never 404s on a fresh database.
 */
@Injectable()
export class PassRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async findOne() {
    const existing = await this.prisma.exam_pass_rules_settings.findFirst();
    if (existing) return existing;
    return this.prisma.exam_pass_rules_settings.create({ data: {} });
  }

  async update(dto: UpdatePassRulesDto) {
    const existing = await this.findOne();
    return this.prisma.exam_pass_rules_settings.update({
      where: { id: existing.id },
      data: { ...dto, updated_at: new Date() },
    });
  }
}
