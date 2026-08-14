jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { PayslipRequestsService } from './payslip-requests.service';

describe('PayslipRequestsService', () => {
  let service: PayslipRequestsService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    payslip_requests: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      payslip_requests: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PayslipRequestsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PayslipRequestsService>(PayslipRequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('update', () => {
    it('throws 404 when the request does not exist', async () => {
      prisma.payslip_requests.findUnique.mockResolvedValue(null);

      await expect(
        service.update(1, { status: 'processed' }),
      ).rejects.toThrow('Payslip request not found');
    });

    it('throws 409 when the request has already been processed', async () => {
      prisma.payslip_requests.findUnique.mockResolvedValue({
        id: 1,
        status: 'rejected',
      });

      await expect(
        service.update(1, { status: 'processed' }),
      ).rejects.toThrow('This payslip request has already been processed');
    });

    it('marks the request processed with no file required', async () => {
      prisma.payslip_requests.findUnique.mockResolvedValue({
        id: 1,
        status: 'pending',
      });
      prisma.payslip_requests.update.mockResolvedValue({
        id: 1,
        month: 8,
        year: 2026,
        status: 'processed',
        file_url: null,
        requested_at: new Date('2026-08-01T00:00:00.000Z'),
        purpose: null,
        faculty: { id: 5, first_name: 'Deepa', last_name: 'Kannan', designation: 'Professor' },
      });

      const result = await service.update(1, { status: 'processed' });

      expect(prisma.payslip_requests.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { status: 'processed' },
        }),
      );
      expect(result.status).toBe('processed');
      expect(result.file_url).toBeNull();
    });

    it('marks the request rejected', async () => {
      prisma.payslip_requests.findUnique.mockResolvedValue({
        id: 1,
        status: 'pending',
      });
      prisma.payslip_requests.update.mockResolvedValue({
        id: 1,
        month: 8,
        year: 2026,
        status: 'rejected',
        file_url: null,
        requested_at: new Date('2026-08-01T00:00:00.000Z'),
        purpose: null,
        faculty: { id: 5, first_name: 'Deepa', last_name: 'Kannan', designation: 'Professor' },
      });

      const result = await service.update(1, { status: 'rejected' });

      expect(result.status).toBe('rejected');
    });
  });
});
