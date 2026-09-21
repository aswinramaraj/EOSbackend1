import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateCanteenSettingsDto } from './dto/update-canteen-settings.dto';

@Injectable()
export class CanteenSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private toResponse(row: {
    id: number;
    gst_percentage: unknown;
    parcel_charge: unknown;
    updated_at: Date;
  }) {
    return {
      gst_percentage: Number(row.gst_percentage),
      parcel_charge: Number(row.parcel_charge),
      updated_at: row.updated_at.toISOString(),
    };
  }

  /** Single settings row seeded by the schema migration — always operate on the lowest id. */
  async get() {
    const row = await this.prisma.canteen_settings.findFirstOrThrow({
      orderBy: { id: 'asc' },
    });
    return this.toResponse(row);
  }

  async update(dto: UpdateCanteenSettingsDto) {
    const existing = await this.prisma.canteen_settings.findFirstOrThrow({
      orderBy: { id: 'asc' },
    });
    const updated = await this.prisma.canteen_settings.update({
      where: { id: existing.id },
      data: {
        ...(dto.gst_percentage !== undefined && {
          gst_percentage: dto.gst_percentage,
        }),
        ...(dto.parcel_charge !== undefined && {
          parcel_charge: dto.parcel_charge,
        }),
        updated_at: new Date(),
      },
    });
    return this.toResponse(updated);
  }
}
