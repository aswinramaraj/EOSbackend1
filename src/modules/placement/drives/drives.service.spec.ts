import { Test, TestingModule } from '@nestjs/testing';
import { DrivesService } from './drives.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';

// The real PrismaService pulls in the generated Prisma client, which uses
// `import.meta.url` and cannot be parsed by ts-jest's CommonJS transform.
// Mock it out before it's ever required.
jest.mock('../../../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('DrivesService', () => {
  let service: DrivesService;
  let prisma: {
    students: { findUnique: jest.Mock };
    student_drive_applications: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      student_drive_applications: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DrivesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompaniesService, useValue: {} },
      ],
    }).compile();

    service = module.get<DrivesService>(DrivesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  const jwtUser = { sub: 1, email: 'x@x.com', role: 'student', roleId: 6 };

  function driveApplication(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      status: 'applied',
      updated_at: new Date('2026-08-01T00:00:00.000Z'),
      placement_drives: {
        id: 10,
        scheduled_date: new Date('2026-09-01T00:00:00.000Z'),
        status: 'scheduled',
        is_disclosed: true,
        disclosed_reveal_date: null,
        companies: { name: 'TCS', profile_info: 'IT services' },
      },
      ...overrides,
    };
  }

  describe('getUpcomingForStudent', () => {
    it('throws 404 when the JWT user has no linked student record', async () => {
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(service.getUpcomingForStudent(jwtUser)).rejects.toThrow(
        'Student profile not found for the current user',
      );
    });

    it('filters to non-concluded statuses, ordered by soonest scheduled_date', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([]);

      await service.getUpcomingForStudent(jwtUser);

      const [args] = prisma.student_drive_applications.findMany.mock
        .calls[0] as [{ where: Record<string, unknown>; orderBy: unknown }];
      expect(args.where).toEqual({
        student_id: 42,
        status: { notIn: ['rejected', 'placed'] },
      });
      expect(args.orderBy).toEqual({
        placement_drives: { scheduled_date: 'asc' },
      });
    });

    it('includes the application_status field in the response', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([
        driveApplication({ status: 'r1_cleared' }),
      ]);

      const result = await service.getUpcomingForStudent(jwtUser);

      expect(result).toEqual([
        {
          drive_id: 10,
          company_name: 'TCS',
          company_profile_info: 'IT services',
          scheduled_date: new Date('2026-09-01T00:00:00.000Z'),
          is_disclosed: true,
          disclosed_reveal_date: null,
          application_status: 'r1_cleared',
        },
      ]);
    });

    it('masks the company name/profile and surfaces disclosed_reveal_date for an undisclosed drive', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([
        driveApplication({
          placement_drives: {
            id: 11,
            scheduled_date: new Date('2026-09-10T00:00:00.000Z'),
            status: 'scheduled',
            is_disclosed: false,
            disclosed_reveal_date: new Date('2026-09-05T00:00:00.000Z'),
            companies: { name: 'Secret Corp', profile_info: 'Stealth mode' },
          },
        }),
      ]);

      const result = await service.getUpcomingForStudent(jwtUser);

      expect(result[0]).toEqual({
        drive_id: 11,
        company_name: 'Undisclosed',
        company_profile_info: null,
        scheduled_date: new Date('2026-09-10T00:00:00.000Z'),
        is_disclosed: false,
        disclosed_reveal_date: new Date('2026-09-05T00:00:00.000Z'),
        application_status: 'applied',
      });
    });
  });

  describe('getHistoryForStudent', () => {
    it('throws 404 when the JWT user has no linked student record', async () => {
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(service.getHistoryForStudent(jwtUser)).rejects.toThrow(
        'Student profile not found for the current user',
      );
    });

    it('filters to concluded application statuses (placed/rejected) only', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([]);

      await service.getHistoryForStudent(jwtUser);

      const [args] = prisma.student_drive_applications.findMany.mock
        .calls[0] as [{ where: Record<string, unknown> }];
      expect(args.where).toEqual({
        student_id: 42,
        status: { in: ['rejected', 'placed'] },
      });
    });

    it('includes application_status and drive_status, and masks an undisclosed company', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([
        driveApplication({
          status: 'placed',
          last_cleared_round: 3,
          placement_drives: {
            id: 12,
            scheduled_date: new Date('2026-08-01T00:00:00.000Z'),
            status: 'scheduled',
            is_disclosed: false,
            disclosed_reveal_date: null,
            companies: { name: 'Secret Corp', profile_info: null },
          },
        }),
      ]);

      const result = await service.getHistoryForStudent(jwtUser);

      expect(result).toEqual([
        {
          drive_id: 12,
          company_name: 'Undisclosed',
          scheduled_date: new Date('2026-08-01T00:00:00.000Z'),
          drive_status: 'scheduled',
          application_status: 'placed',
          last_cleared_round: 3,
        },
      ]);
    });

    it('surfaces last_cleared_round for a student rejected after clearing a round', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([
        driveApplication({ status: 'rejected', last_cleared_round: 2 }),
      ]);

      const result = await service.getHistoryForStudent(jwtUser);

      expect(result[0]).toMatchObject({
        application_status: 'rejected',
        last_cleared_round: 2,
      });
    });

    it('leaves last_cleared_round null for a student rejected before clearing any round', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([
        driveApplication({ status: 'rejected', last_cleared_round: null }),
      ]);

      const result = await service.getHistoryForStudent(jwtUser);

      expect(result[0]).toMatchObject({
        application_status: 'rejected',
        last_cleared_round: null,
      });
    });
  });

  describe('updateApplicationStatus', () => {
    const jwtActor = { sub: 10, email: 'staff@x.com', role: 'placement', roleId: 1 };

    function mockExistingApplication() {
      prisma.student_drive_applications.findUnique.mockResolvedValue({
        id: 99,
        drive_id: 1,
        student_id: 42,
        status: 'applied',
        last_cleared_round: null,
      });
    }

    it.each([
      ['r1_cleared', 1],
      ['r2_cleared', 2],
      ['r3_cleared', 3],
      ['placed', 3],
    ] as const)(
      'sets last_cleared_round to %s when status becomes %s',
      async (status, expectedRound) => {
        mockExistingApplication();
        prisma.student_drive_applications.update.mockResolvedValue({});

        await service.updateApplicationStatus(jwtActor, 1, 42, { status });

        const [args] = prisma.student_drive_applications.update.mock
          .calls[0] as [{ data: Record<string, unknown> }];
        expect(args.data).toMatchObject({
          status,
          last_cleared_round: expectedRound,
        });
      },
    );

    it('does not touch last_cleared_round when the new status is rejected', async () => {
      mockExistingApplication();
      prisma.student_drive_applications.update.mockResolvedValue({});

      await service.updateApplicationStatus(jwtActor, 1, 42, {
        status: 'rejected',
      });

      const [args] = prisma.student_drive_applications.update.mock
        .calls[0] as [{ data: Record<string, unknown> }];
      expect(args.data).not.toHaveProperty('last_cleared_round');
      expect(args.data).toMatchObject({ status: 'rejected' });
    });

    it('does not touch last_cleared_round when the new status is applied', async () => {
      mockExistingApplication();
      prisma.student_drive_applications.update.mockResolvedValue({});

      await service.updateApplicationStatus(jwtActor, 1, 42, {
        status: 'applied',
      });

      const [args] = prisma.student_drive_applications.update.mock
        .calls[0] as [{ data: Record<string, unknown> }];
      expect(args.data).not.toHaveProperty('last_cleared_round');
    });
  });
});
