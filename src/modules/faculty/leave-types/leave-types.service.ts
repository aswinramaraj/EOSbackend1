import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class LeaveTypesService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /leave-types — active leave types (Casual, Sick, Earned, etc.) for
   * the Leave Type picker. Read-only reference data — managed directly in
   * the database, not through this API. */
  async findAll() {
    return this.prisma.leave_types.findMany({
      where: { is_active: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, default_annual_quota: true },
    });
  }
}
