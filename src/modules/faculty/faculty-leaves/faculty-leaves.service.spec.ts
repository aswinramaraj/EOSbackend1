jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { FacultyLeavesService } from './faculty-leaves.service';

describe('FacultyLeavesService', () => {
  let service: FacultyLeavesService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    faculty_leaves: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      faculty_leaves: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacultyLeavesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<FacultyLeavesService>(FacultyLeavesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('force-scopes a FACULTY caller to their own faculty_id regardless of the query param', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        { faculty_id: 999, limit: 20, page: 1 } as any,
        { sub: 1, role: 'faculty', email: 'x', roleId: 1 },
      );

      expect(prisma.faculty.findUnique).toHaveBeenCalledWith({
        where: { user_id: 1 },
      });
    });

    it('does not resolve a faculty record for an HoD caller (unrestricted)', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        { limit: 20, page: 1 } as any,
        { sub: 2, role: 'hod', email: 'x', roleId: 1 },
      );

      expect(prisma.faculty.findUnique).not.toHaveBeenCalled();
    });

    it('force-filters an HR Payroll caller to hod_approval_status=approved, overriding whatever the query param says', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        { hod_approval_status: 'pending', limit: 20, page: 1 } as any,
        { sub: 3, role: 'hr_payroll', email: 'x', roleId: 1 },
      );

      expect(prisma.faculty_leaves.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ hod_approval_status: 'approved' }),
        }),
      );
    });
  });
});
