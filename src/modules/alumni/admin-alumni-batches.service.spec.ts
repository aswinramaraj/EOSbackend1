import { Test, TestingModule } from '@nestjs/testing';
import { AdminAlumniBatchesService } from './admin-alumni-batches.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';

jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('AdminAlumniBatchesService', () => {
  let service: AdminAlumniBatchesService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      alumni_batches: { findMany: jest.fn(), count: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAlumniBatchesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AdminAlumniBatchesService>(
      AdminAlumniBatchesService,
    );
  });

  it('resolves member_count via a single aggregate query, not N+1', async () => {
    mockPrisma.alumni_batches.findMany.mockResolvedValue([
      {
        id: 1,
        batch_id: 10,
        group_name: 'AI&DS 2022-2026 Alumni',
        graduated_on: new Date('2026-05-01'),
        created_at: new Date('2026-05-01'),
        batches: { id: 10, name: '2022-2026' },
        _count: { alumni_members: 42 },
      },
    ]);
    mockPrisma.alumni_batches.count.mockResolvedValue(1);

    const dto = Object.assign(new PaginationDto(), { page: 1, limit: 20 });
    const result = await service.listBatches(dto);

    // Exactly two calls total (findMany + count) — no per-row count queries.
    expect(mockPrisma.alumni_batches.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.alumni_batches.count).toHaveBeenCalledTimes(1);
    expect(mockPrisma.alumni_batches.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          _count: { select: { alumni_members: true } },
        }),
      }),
    );

    expect(result.data).toEqual([
      expect.objectContaining({ id: 1, member_count: 42 }),
    ]);
    expect(result.data[0]).not.toHaveProperty('_count');
    expect(result.meta.total).toBe(1);
  });
});
