jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { StudentLeavesService } from './student-leaves.service';

describe('StudentLeavesService', () => {
  let service: StudentLeavesService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    class_mentors: { findMany: jest.Mock; findFirst: jest.Mock };
    student_leaves: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  function leaveRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      student_id: 42,
      from_date: new Date('2026-08-17T00:00:00.000Z'),
      to_date: new Date('2026-08-18T00:00:00.000Z'),
      reason: 'Fever',
      status: 'pending',
      approved_by_faculty_id: null,
      approved_by_hod_user_id: null,
      created_at: new Date('2026-08-10T00:00:00.000Z'),
      students: {
        id: 42,
        student_id_no: '23EC056',
        class_id: 5,
        soa_applications: { first_name: 'Arjun', last_name: 'Kumar' },
        users: { id: 100, email: 'arjun@sece.ac.in' },
        classes: { section: 'B', departments: { name: 'Electronics Engineering' } },
      },
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      class_mentors: { findMany: jest.fn(), findFirst: jest.fn() },
      student_leaves: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentLeavesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<StudentLeavesService>(StudentLeavesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('throws 404 when the caller has no faculty profile', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(service.findAll({ limit: 20, page: 1 } as any, 1)).rejects.toThrow(
        'Faculty profile not found for the authenticated user',
      );
    });

    it('returns an empty page (not an error) when the faculty mentors no class', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.class_mentors.findMany.mockResolvedValue([]);

      const result = await service.findAll({ limit: 20, page: 1 } as any, 1);

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(prisma.student_leaves.findMany).not.toHaveBeenCalled();
    });

    it('scopes the query to classes the faculty mentors, and resolves student name/section/department', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.class_mentors.findMany.mockResolvedValue([
        { class_id: 5 },
        { class_id: 9 },
      ]);
      prisma.student_leaves.findMany.mockResolvedValue([leaveRow()]);
      prisma.student_leaves.count.mockResolvedValue(1);

      const result = await service.findAll(
        { limit: 20, page: 1, skip: 0 } as any,
        1,
      );

      const [findManyArgs] = prisma.student_leaves.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(findManyArgs.where).toMatchObject({
        students: { class_id: { in: [5, 9] } },
      });
      expect(result.data[0]).toMatchObject({
        id: 1,
        student: {
          id: 42,
          student_id_no: '23EC056',
          name: 'Arjun Kumar',
          section: 'B',
          department_name: 'Electronics Engineering',
        },
      });
    });

    it('falls back to the linked user email when there is no soa_applications name, and null section/department when the student has no class', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.class_mentors.findMany.mockResolvedValue([{ class_id: 5 }]);
      prisma.student_leaves.findMany.mockResolvedValue([
        leaveRow({
          students: {
            id: 42,
            student_id_no: '23EC056',
            class_id: null,
            soa_applications: null,
            users: { id: 100, email: 'arjun@sece.ac.in' },
            classes: null,
          },
        }),
      ]);
      prisma.student_leaves.count.mockResolvedValue(1);

      const result = await service.findAll({ limit: 20, page: 1 } as any, 1);

      expect(result.data[0].student).toMatchObject({
        name: 'arjun@sece.ac.in',
        section: null,
        department_name: null,
      });
    });
  });

  describe('facultyApprove', () => {
    it('throws 403 NOT_THE_MENTOR when the caller does not mentor this student\'s class', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.student_leaves.findUnique.mockResolvedValue({
        status: 'pending',
        students: { class_id: 5 },
      });
      prisma.class_mentors.findFirst.mockResolvedValue(null);

      await expect(
        service.facultyApprove(1, { decision: 'approved' }, 1),
      ).rejects.toMatchObject({
        status: 403,
        response: { errorCode: 'NOT_THE_MENTOR' },
      });
    });

    it('throws 422 ALREADY_DECIDED when the leave is not still pending', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.student_leaves.findUnique.mockResolvedValue({
        status: 'faculty_approved',
        students: { class_id: 5 },
      });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });

      await expect(
        service.facultyApprove(1, { decision: 'approved' }, 1),
      ).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'ALREADY_DECIDED' },
      });
    });

    it('sets status to faculty_approved and records approved_by_faculty_id on approve', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.student_leaves.findUnique.mockResolvedValue({
        status: 'pending',
        students: { class_id: 5 },
      });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.student_leaves.update.mockResolvedValue(leaveRow({ status: 'faculty_approved' }));

      await service.facultyApprove(1, { decision: 'approved' }, 1);

      expect(prisma.student_leaves.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'faculty_approved', approved_by_faculty_id: 7 },
        select: expect.any(Object),
      });
    });

    it('short-circuits straight to rejected on reject, without setting approved_by_faculty_id', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.student_leaves.findUnique.mockResolvedValue({
        status: 'pending',
        students: { class_id: 5 },
      });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.student_leaves.update.mockResolvedValue(leaveRow({ status: 'rejected' }));

      await service.facultyApprove(1, { decision: 'rejected' }, 1);

      expect(prisma.student_leaves.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'rejected' },
        select: expect.any(Object),
      });
    });
  });

  describe('hodApprove', () => {
    it('throws 422 NOT_FACULTY_APPROVED_YET when still pending', async () => {
      prisma.student_leaves.findUnique.mockResolvedValue({ status: 'pending' });

      await expect(
        service.hodApprove(1, { decision: 'approved' }, 99),
      ).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'NOT_FACULTY_APPROVED_YET' },
      });
    });

    it('throws 422 ALREADY_DECIDED when already hod_approved/rejected', async () => {
      prisma.student_leaves.findUnique.mockResolvedValue({ status: 'rejected' });

      await expect(
        service.hodApprove(1, { decision: 'approved' }, 99),
      ).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'ALREADY_DECIDED' },
      });
    });

    it('sets status to hod_approved and records approved_by_hod_user_id on approve', async () => {
      prisma.student_leaves.findUnique.mockResolvedValue({ status: 'faculty_approved' });
      prisma.student_leaves.update.mockResolvedValue(leaveRow({ status: 'hod_approved' }));

      await service.hodApprove(1, { decision: 'approved' }, 99);

      expect(prisma.student_leaves.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'hod_approved', approved_by_hod_user_id: 99 },
        select: expect.any(Object),
      });
    });
  });
});
