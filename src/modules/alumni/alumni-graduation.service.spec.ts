import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { AlumniGraduationService } from './alumni-graduation.service';
import { PrismaService } from 'src/prisma/prisma.service';

// The real PrismaService pulls in the generated Prisma client, which uses
// `import.meta.url` and cannot be parsed by ts-jest's CommonJS transform.
// Mock it out before it's ever required.
jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('AlumniGraduationService', () => {
  let service: AlumniGraduationService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      batches: { findUnique: jest.fn(), findMany: jest.fn() },
      alumni_batches: { findUnique: jest.fn(), create: jest.fn() },
      roles: { upsert: jest.fn() },
      students: { findMany: jest.fn() },
      courses: { findUnique: jest.fn() },
      alumni_members: { create: jest.fn() },
      users: { update: jest.fn() },
      // Interactive transaction: the callback receives the same mock, since
      // every model method is on the one object regardless of tx vs bare use.
      $transaction: jest.fn((callback: (tx: any) => unknown) =>
        callback(mockPrisma),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlumniGraduationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AlumniGraduationService>(AlumniGraduationService);
  });

  describe('graduateBatch', () => {
    it('throws NotFoundException when the batch does not exist', async () => {
      mockPrisma.batches.findUnique.mockResolvedValue(null);

      await expect(service.graduateBatch(999)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('throws ConflictException (fast path) when already graduated', async () => {
      mockPrisma.batches.findUnique.mockResolvedValue({
        id: 1,
        name: '2018-2022',
        start_year: 2018,
        end_year: 2022,
      });
      mockPrisma.alumni_batches.findUnique.mockResolvedValue({
        id: 5,
        batch_id: 1,
      });

      await expect(service.graduateBatch(1)).rejects.toThrow(ConflictException);
      // Never even opens a transaction for a batch we already know is done.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('is idempotent: a second concurrent call racing past the fast check still rejects inside the transaction', async () => {
      mockPrisma.batches.findUnique.mockResolvedValue({
        id: 1,
        name: '2018-2022',
        start_year: 2018,
        end_year: 2022,
      });
      // Fast pre-check sees nothing yet...
      mockPrisma.alumni_batches.findUnique
        .mockResolvedValueOnce(null)
        // ...but by the time we're inside the transaction, another caller won the race.
        .mockResolvedValueOnce({ id: 5, batch_id: 1 });

      await expect(service.graduateBatch(1)).rejects.toThrow(ConflictException);
      expect(mockPrisma.alumni_batches.create).not.toHaveBeenCalled();
    });

    it('graduates every student in the batch and flips their role in one transaction', async () => {
      mockPrisma.batches.findUnique.mockResolvedValue({
        id: 1,
        name: '2022-2026',
        start_year: 2022,
        end_year: 2026,
      });
      mockPrisma.alumni_batches.findUnique.mockResolvedValue(null);
      mockPrisma.roles.upsert.mockResolvedValue({ id: 99, name: 'alumni' });
      // 1st students.findMany call: distinct course_id lookup for the group name.
      mockPrisma.students.findMany
        .mockResolvedValueOnce([{ course_id: 5 }])
        // 2nd students.findMany call: the full roster to graduate.
        .mockResolvedValueOnce([
          { id: 101, user_id: 501 },
          { id: 102, user_id: 502 },
        ]);
      mockPrisma.courses.findUnique.mockResolvedValue({
        id: 5,
        code: 'AI&DS',
      });
      mockPrisma.alumni_batches.create.mockResolvedValue({
        id: 10,
        group_name: 'AI&DS 2022-2026 Alumni',
      });
      mockPrisma.alumni_members.create.mockResolvedValue({});
      mockPrisma.users.update.mockResolvedValue({});

      const result = await service.graduateBatch(1);

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
      expect(mockPrisma.alumni_batches.create).toHaveBeenCalledWith({
        data: { batch_id: 1, group_name: 'AI&DS 2022-2026 Alumni' },
      });
      expect(mockPrisma.alumni_members.create).toHaveBeenCalledTimes(2);
      expect(mockPrisma.alumni_members.create).toHaveBeenNthCalledWith(1, {
        data: { alumni_batch_id: 10, student_id: 101 },
      });
      expect(mockPrisma.users.update).toHaveBeenCalledTimes(2);
      expect(mockPrisma.users.update).toHaveBeenNthCalledWith(1, {
        where: { id: 501 },
        data: { role_id: 99 },
      });
      expect(mockPrisma.users.update).toHaveBeenNthCalledWith(2, {
        where: { id: 502 },
        data: { role_id: 99 },
      });
      expect(result).toEqual({
        alumni_batch_id: 10,
        batch_id: 1,
        group_name: 'AI&DS 2022-2026 Alumni',
        graduated_students: 2,
      });
    });

    it('falls back to the batch name when students span more than one course', async () => {
      mockPrisma.batches.findUnique.mockResolvedValue({
        id: 2,
        name: '2019-2023',
        start_year: 2019,
        end_year: 2023,
      });
      mockPrisma.alumni_batches.findUnique.mockResolvedValue(null);
      mockPrisma.roles.upsert.mockResolvedValue({ id: 99, name: 'alumni' });
      mockPrisma.students.findMany
        .mockResolvedValueOnce([{ course_id: 5 }, { course_id: 6 }])
        .mockResolvedValueOnce([]);
      mockPrisma.alumni_batches.create.mockResolvedValue({
        id: 11,
        group_name: '2019-2023 Alumni',
      });

      await service.graduateBatch(2);

      expect(mockPrisma.courses.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.alumni_batches.create).toHaveBeenCalledWith({
        data: { batch_id: 2, group_name: '2019-2023 Alumni' },
      });
    });

    it('propagates a mid-loop failure so no partial state is left behind', async () => {
      mockPrisma.batches.findUnique.mockResolvedValue({
        id: 1,
        name: '2022-2026',
        start_year: 2022,
        end_year: 2026,
      });
      mockPrisma.alumni_batches.findUnique.mockResolvedValue(null);
      mockPrisma.roles.upsert.mockResolvedValue({ id: 99, name: 'alumni' });
      mockPrisma.students.findMany
        .mockResolvedValueOnce([]) // distinct courses: none, irrelevant here
        .mockResolvedValueOnce([
          { id: 101, user_id: 501 },
          { id: 102, user_id: 502 },
        ]);
      mockPrisma.alumni_batches.create.mockResolvedValue({
        id: 10,
        group_name: '2022-2026 Alumni',
      });
      mockPrisma.alumni_members.create
        .mockResolvedValueOnce({}) // student 101 succeeds
        .mockRejectedValueOnce(new Error('DB write failed')); // student 102 fails

      await expect(service.graduateBatch(1)).rejects.toThrow('DB write failed');
      // The second student's role must never have been flipped once its
      // alumni_members insert failed — proves the failure isn't swallowed
      // partway through the loop.
      expect(mockPrisma.users.update).toHaveBeenCalledTimes(1);
    });
  });

  describe('runDailyGraduation', () => {
    beforeEach(() => {
      jest.useFakeTimers().setSystemTime(new Date('2026-08-01T00:00:00Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('only queries batches whose end_year has fully elapsed and has no alumni_batches row', async () => {
      mockPrisma.batches.findMany.mockResolvedValue([]);

      await service.runDailyGraduation();

      expect(mockPrisma.batches.findMany).toHaveBeenCalledWith({
        where: { end_year: { lt: 2026 }, alumni_batches: null },
        select: { id: true },
      });
    });

    it('keeps processing remaining batches when one fails', async () => {
      mockPrisma.batches.findMany.mockResolvedValue([
        { id: 1 },
        { id: 2 },
        { id: 3 },
      ]);
      const spy = jest
        .spyOn(service, 'graduateBatch')
        .mockResolvedValueOnce({} as any)
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({} as any);

      await expect(service.runDailyGraduation()).resolves.toBeUndefined();

      expect(spy).toHaveBeenCalledTimes(3);
      expect(spy).toHaveBeenNthCalledWith(1, 1);
      expect(spy).toHaveBeenNthCalledWith(2, 2);
      expect(spy).toHaveBeenNthCalledWith(3, 3);
    });
  });
});
