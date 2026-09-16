jest.mock('../../../../generated/prisma/client', () => {
  const actual = jest.requireActual('../../../../generated/prisma/client');
  return { ...actual, PrismaClient: class {} };
});
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { PrincipalDashboardService } from './dashboard.service';

describe('PrincipalDashboardService', () => {
  let service: PrincipalDashboardService;
  let prisma: {
    students: { count: jest.Mock };
    faculty: { count: jest.Mock };
    non_teaching_staff: { count: jest.Mock };
    departments: { count: jest.Mock };
    $queryRaw: jest.Mock;
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      students: { count: jest.fn().mockResolvedValue(0) },
      faculty: { count: jest.fn().mockResolvedValue(0) },
      non_teaching_staff: { count: jest.fn().mockResolvedValue(0) },
      departments: { count: jest.fn().mockResolvedValue(0) },
      $queryRaw: jest.fn().mockResolvedValue([]),
      // Real Prisma resolves each item in the array; mock does the same.
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PrincipalDashboardService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PrincipalDashboardService>(PrincipalDashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('summaryForPeriod', () => {
    it('computes attendance percentage/below-threshold/best-month from one grouped query, not a per-row fetch', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          total: 100n,
          present: 80n,
          students_below_threshold: 4n,
          best_month_key: '2026-08',
        },
      ]);

      const result = await service.summaryForPeriod('term');

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result.attendance).toEqual({
        percentage: 80,
        students_below_threshold: 4,
        best_month: 'August',
      });
    });

    it('handles an empty period (no attendance rows) without throwing', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        {
          total: 0n,
          present: 0n,
          students_below_threshold: 0n,
          best_month_key: null,
        },
      ]);

      const result = await service.summaryForPeriod('term');

      expect(result.attendance).toEqual({
        percentage: null,
        students_below_threshold: 0,
        best_month: null,
      });
    });
  });

  // The 3 flag methods below are private (called internally by the public
  // `insights()`, which also pulls in placement/campus/hostel/transport data
  // unrelated to what changed here) — accessed directly to keep this test
  // focused on the actual behavior change (grouped SQL vs. per-row fetch).
  type PrivateFlags = {
    departmentAttendanceFlags: () => Promise<
      { type: string; title: string; description: string }[]
    >;
    facultyWorkloadFlags: () => Promise<{
      type: string;
      title: string;
      description: string;
    } | null>;
    courseCompletionFlags: () => Promise<
      { type: string; title: string; description: string }[]
    >;
  };
  const flags = () => service as unknown as PrivateFlags;

  describe('departmentAttendanceFlags', () => {
    it('flags only departments below the 75% threshold, from one grouped query', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { code: 'CS', name: 'Computer Science', present: 60n, total: 100n },
        { code: 'EC', name: 'Electronics', present: 90n, total: 100n },
      ]);

      const result = await flags().departmentAttendanceFlags();

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({ title: 'CS attendance at 60%' });
    });

    it('serves a second call within the TTL from cache, without re-querying', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { code: 'CS', name: 'Computer Science', present: 60n, total: 100n },
      ]);

      const first = await flags().departmentAttendanceFlags();
      const second = await flags().departmentAttendanceFlags();

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });
  });

  describe('facultyWorkloadFlags', () => {
    it('returns null when nobody is over the threshold', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { overloaded_count: 0n, dept_codes: null },
      ]);

      const result = await flags().facultyWorkloadFlags();

      expect(result).toBeNull();
    });

    it('returns a flag with the overloaded count and department codes from one grouped query', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { overloaded_count: 3n, dept_codes: ['CS', 'EC'] },
      ]);

      const result = await flags().facultyWorkloadFlags();

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ description: '3 faculty across CS, EC' });
    });
  });

  describe('courseCompletionFlags', () => {
    it('flags course completion below the 60% threshold, from one grouped query', async () => {
      prisma.$queryRaw.mockResolvedValueOnce([
        { code: 'ME', covered: 30n, total: 100n },
      ]);

      const result = await flags().courseCompletionFlags();

      expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result[0]).toMatchObject({
        title: 'Course completion behind in ME',
      });
    });
  });
});
