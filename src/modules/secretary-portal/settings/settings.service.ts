import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';

/** Per-user preferences — Secretary Portal "Settings" screen. */
@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getMine(userId: number) {
    const row = await this.prisma.user_preferences.findUnique({ where: { user_id: userId } });
    if (row) return row;
    // No row yet — real defaults matching the column defaults, not fabricated
    // (identical to what a fresh INSERT would produce).
    return {
      user_id: userId,
      daily_attendance_digest: true,
      sop_escalation_alerts: true,
      auto_circulate_mom: false,
      compact_tables: false,
      updated_at: null,
    };
  }

  async updateMine(userId: number, dto: UpdateSettingsDto) {
    const existing = await this.getMine(userId);
    return this.prisma.user_preferences.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        daily_attendance_digest: dto.daily_attendance_digest ?? existing.daily_attendance_digest,
        sop_escalation_alerts: dto.sop_escalation_alerts ?? existing.sop_escalation_alerts,
        auto_circulate_mom: dto.auto_circulate_mom ?? existing.auto_circulate_mom,
        compact_tables: dto.compact_tables ?? existing.compact_tables,
      },
      update: {
        ...(dto.daily_attendance_digest !== undefined && { daily_attendance_digest: dto.daily_attendance_digest }),
        ...(dto.sop_escalation_alerts !== undefined && { sop_escalation_alerts: dto.sop_escalation_alerts }),
        ...(dto.auto_circulate_mom !== undefined && { auto_circulate_mom: dto.auto_circulate_mom }),
        ...(dto.compact_tables !== undefined && { compact_tables: dto.compact_tables }),
        updated_at: new Date(),
      },
    });
  }
}
