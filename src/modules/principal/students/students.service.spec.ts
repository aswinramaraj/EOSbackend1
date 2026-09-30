jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
  // Real Prisma.sql builds a tagged-template Sql object for $queryRaw; the
  // mocked $queryRaw below never actually parses it, it just needs
  // something to pass through.
  Prisma: {
    sql: (strings: unknown, ...values: unknown[]) => ({ strings, values }),
    join: (values: unknown[]) => ({ values }),
  },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { PrincipalStudentsService } from './students.service';
import { PrincipalDashboardService } from '../dashboard/dashboard.service';

describe('PrincipalStudentsService', () => {
  let service: PrincipalStudentsService;
  let prisma: {
    students: { findMany: jest.Mock };
    student_drive_applications: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let dashboard: {
    summary: jest.Mock;
    summaryForPeriod: jest.Mock;
    computeFeesOutstanding: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      students: { findMany: jest.fn() },
      student_drive_applications: { findMany: jest.fn() },
      $queryRaw: jest.fn(),
    };
    dashboard = {
      summary: jest.fn(),
      summaryForPeriod: jest.fn(),
      computeFeesOutstanding: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrincipalStudentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: PrincipalDashboardService, useValue: dashboard },
      ],
    }).compile();

    service = module.get<PrincipalStudentsService>(PrincipalStudentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('summary', () => {
    function mockCommon() {
      dashboard.summary.mockResolvedValue({
        students: {
          total_active: 500,
          present_today: 430,
          absent_today: 70,
          attendance_percentage_today: 86,
        },
      });
      dashboard.summaryForPeriod.mockResolvedValue({
        attendance: { students_below_threshold: 12 },
      });
      dashboard.computeFeesOutstanding.mockResolvedValue({
        totalOutstanding: 50000,
        studentsWithOutstanding: 8,
      });
      prisma.student_drive_applications.findMany.mockResolvedValue([]);
    }

    it('includes a real, credit-weighted institution-wide mean_cgpa alongside the existing tiles', async () => {
      mockCommon();
      prisma.students.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);
      prisma.$queryRaw.mockResolvedValue([{ mean_cgpa: '7.845' }]);

      const result = await service.summary();

      expect(prisma.students.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'active' } }),
      );
      expect(result).toMatchObject({
        on_roll: 500,
        present_today: 430,
        absent_today: 70,
        attendance_percentage_today: 86,
        students_below_threshold: 12,
        mean_cgpa: 7.85,
      });
    });

    it('returns a null mean_cgpa (not NaN or 0) when no active students exist', async () => {
      mockCommon();
      prisma.students.findMany.mockResolvedValue([]);

      const result = await service.summary();

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
      expect(result.mean_cgpa).toBeNull();
    });

    it('returns a null mean_cgpa when active students exist but none have published, gradeable marks', async () => {
      mockCommon();
      prisma.students.findMany.mockResolvedValue([{ id: 1 }]);
      prisma.$queryRaw.mockResolvedValue([{ mean_cgpa: null }]);

      const result = await service.summary();

      expect(result.mean_cgpa).toBeNull();
    });
  });
});
