import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateHostelSettingsDto } from './dto/update-hostel-settings.dto';

function toResponse(row: {
  id: number;
  auto_approve_low_risk: boolean;
  min_attendance_for_auto_pct: unknown;
  require_biometric_pop: boolean;
  sms_guardian_on_checkout: boolean;
  alert_on_overdue_return: boolean;
  weekly_arrears_reminder: boolean;
  publish_resolved_complaints: boolean;
  max_outing_days: number;
  updated_at: Date;
}) {
  return {
    id: row.id,
    auto_approve_low_risk: row.auto_approve_low_risk,
    min_attendance_for_auto_pct: Number(row.min_attendance_for_auto_pct),
    require_biometric_pop: row.require_biometric_pop,
    sms_guardian_on_checkout: row.sms_guardian_on_checkout,
    alert_on_overdue_return: row.alert_on_overdue_return,
    weekly_arrears_reminder: row.weekly_arrears_reminder,
    publish_resolved_complaints: row.publish_resolved_complaints,
    max_outing_days: row.max_outing_days,
    updated_at: row.updated_at,
  };
}

@Injectable()
export class HostelSettingsService {
  private readonly logger = new Logger(HostelSettingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** There is exactly one hostel-wide config row, ever — created lazily on
   * first read/write with schema defaults, matching LibrarySettingsService's
   * getOrCreateRow() pattern. */
  private async getOrCreateRow() {
    try {
      const existing = await this.prisma.hostel_settings.findFirst();
      if (existing) return existing;
      return await this.prisma.hostel_settings.create({ data: {} });
    } catch (err) {
      this.logger.error('DB error while loading hostel settings', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async get() {
    return toResponse(await this.getOrCreateRow());
  }

  async update(dto: UpdateHostelSettingsDto) {
    const row = await this.getOrCreateRow();
    try {
      const updated = await this.prisma.hostel_settings.update({
        where: { id: row.id },
        data: dto,
      });
      return toResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating hostel settings', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
