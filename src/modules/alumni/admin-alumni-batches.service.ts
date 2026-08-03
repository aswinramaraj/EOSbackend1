import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate, PaginationDto } from 'src/common/dto/pagination.dto';

@Injectable()
export class AdminAlumniBatchesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /admin/alumni-batches
   *
   * member_count is resolved via Prisma's relation `_count` aggregate — one
   * query total, not one `alumni_members.count()` per row.
   */
  async listBatches(dto: PaginationDto) {
    const [rows, total] = await Promise.all([
      this.prisma.alumni_batches.findMany({
        skip: dto.skip,
        take: dto.limit,
        orderBy: { graduated_on: 'desc' },
        include: {
          batches: { select: { id: true, name: true } },
          _count: { select: { alumni_members: true } },
        },
      }),
      this.prisma.alumni_batches.count(),
    ]);

    const data = rows.map(({ _count, ...batch }) => ({
      ...batch,
      member_count: _count.alumni_members,
    }));

    return paginate(data, total, dto);
  }
}
