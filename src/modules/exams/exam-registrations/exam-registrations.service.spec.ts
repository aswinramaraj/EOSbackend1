jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { ExamRegistrationsService } from './exam-registrations.service';

describe('ExamRegistrationsService', () => {
  let service: ExamRegistrationsService;
  let prisma: {
    exam_registrations: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $executeRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      exam_registrations: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamRegistrationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ExamRegistrationsService>(ExamRegistrationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('review', () => {
    it('persists rejection_reason on reject via raw SQL (schema-gap-tolerant — distinct from the manual-entry audit reason column)', async () => {
      prisma.exam_registrations.findUnique.mockResolvedValue({ id: 12 });
      prisma.exam_registrations.update.mockResolvedValue({
        id: 12,
        status: 'rejected',
      });

      await service.review(
        12,
        { status: 'rejected', rejection_reason: 'Fee not paid' } as any,
        7,
      );

      expect(prisma.$executeRaw).toHaveBeenCalled();
    });

    it('does not write a rejection reason when approving', async () => {
      prisma.exam_registrations.findUnique.mockResolvedValue({ id: 12 });
      prisma.exam_registrations.update.mockResolvedValue({
        id: 12,
        status: 'approved',
      });

      await service.review(12, { status: 'approved' } as any, 7);

      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('silently no-ops when rejection_reason column does not exist yet (pre-migration)', async () => {
      prisma.exam_registrations.findUnique.mockResolvedValue({ id: 12 });
      prisma.exam_registrations.update.mockResolvedValue({
        id: 12,
        status: 'rejected',
      });
      prisma.$executeRaw.mockRejectedValue({
        code: 'P2010',
        meta: {
          code: '42703',
          message: 'column "rejection_reason" does not exist',
        },
      });

      await expect(
        service.review(
          12,
          { status: 'rejected', rejection_reason: 'Fee not paid' } as any,
          7,
        ),
      ).resolves.toMatchObject({ id: 12, status: 'rejected' });
    });
  });
});
