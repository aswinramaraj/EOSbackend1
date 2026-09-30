jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { SeatingPlansService } from './seating-plans.service';

describe('SeatingPlansService', () => {
  let service: SeatingPlansService;
  let prisma: {
    seating_plan_versions: { findFirst: jest.Mock; create: jest.Mock };
    seating_plan_version_venues: { findUnique: jest.Mock };
    hall_plans: { findUnique: jest.Mock };
    students: { findMany: jest.Mock };
    seating_arrangements: { findMany: jest.Mock; deleteMany: jest.Mock; createMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const baseDto = {
    exam_id: 1,
    exam_date: '2026-11-10',
    session: 'forenoon' as const,
    venue_id: 5,
  };

  beforeEach(async () => {
    prisma = {
      // A draft version already exists — getOrCreateDraftVersion()'s first
      // findFirst call returns it, so create() is never reached.
      seating_plan_versions: {
        findFirst: jest.fn().mockResolvedValue({ id: 100, status: 'draft', version_number: 1 }),
        create: jest.fn(),
      },
      // This venue is already attached to the draft version, hall_plan_id 1.
      seating_plan_version_venues: {
        findUnique: jest.fn().mockResolvedValue({ id: 200, version_id: 100, venue_id: 5, hall_plan_id: 1 }),
      },
      hall_plans: {
        findUnique: jest.fn().mockResolvedValue({ id: 1, capacity: 60, venues: { capacity: 60 } }),
      },
      students: { findMany: jest.fn() },
      seating_arrangements: {
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn(),
        createMany: jest.fn(),
      },
      $transaction: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SeatingPlansService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<SeatingPlansService>(SeatingPlansService);
  });

  describe('allocateManual', () => {
    it('excludes a register number already seated in a different venue within the same version, reporting it as a conflict', async () => {
      prisma.students.findMany.mockResolvedValue([
        { id: 11, register_no: '22IT101', student_id_no: '22IT101' },
        { id: 12, register_no: '22IT102', student_id_no: '22IT102' },
      ]);
      // Student 11 is already seated in hall_plan_id 999 (a different venue) for this same version.
      prisma.seating_arrangements.findMany.mockResolvedValue([
        { student_id: 11, hall_plans: { venues: { name: 'Main Hall' } } },
      ]);

      const result = await service.allocateManual({
        ...baseDto,
        entries: ['22IT101', '22IT102'],
      } as any);

      expect(prisma.seating_arrangements.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            version_id: 100,
            hall_plan_id: { not: 1 },
          }),
        }),
      );
      expect(result.conflicts).toEqual([{ register_no: '22IT101', already_seated_in: 'Main Hall' }]);
      expect(result.seated).toBe(1);

      // Only the non-conflicting student is written to this venue's roster.
      const createManyCall = prisma.$transaction.mock.calls[0][0];
      expect(createManyCall).toHaveLength(2); // deleteMany + createMany
    });

    it('does not flag a student as a conflict when re-running allocation for the same venue', async () => {
      prisma.students.findMany.mockResolvedValue([
        { id: 11, register_no: '22IT101', student_id_no: '22IT101' },
      ]);
      // The conflict query itself excludes this venue's own hall_plan_id
      // (hall_plan_id: { not: 1 }) — a real re-run naturally returns nothing.
      prisma.seating_arrangements.findMany.mockResolvedValue([]);

      const result = await service.allocateManual({
        ...baseDto,
        entries: ['22IT101'],
      } as any);

      expect(result.conflicts).toEqual([]);
      expect(result.seated).toBe(1);
    });

    it('reports unmatched register numbers as not_found, unaffected by conflict detection', async () => {
      prisma.students.findMany.mockResolvedValue([]);

      const result = await service.allocateManual({
        ...baseDto,
        entries: ['22IT999'],
      } as any);

      expect(result.not_found).toEqual(['22IT999']);
      expect(result.conflicts).toEqual([]);
      expect(result.seated).toBe(0);
    });
  });
});
