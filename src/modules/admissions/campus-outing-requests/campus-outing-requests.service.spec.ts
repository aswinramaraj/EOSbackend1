jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { CampusOutingRequestsService } from './campus-outing-requests.service';

describe('CampusOutingRequestsService', () => {
  let service: CampusOutingRequestsService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    class_mentors: { findMany: jest.Mock; findFirst: jest.Mock };
    campus_outing_requests: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  function outingRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      student_id: 42,
      from_date: new Date('2026-08-17T00:00:00.000Z'),
      to_date: new Date('2026-08-17T00:00:00.000Z'),
      start_time: new Date('1970-01-01T09:00:00.000Z'),
      return_time: new Date('1970-01-01T17:00:00.000Z'),
      reason: 'Bank work',
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
        classes: {
          section: 'B',
          departments: { name: 'Electronics Engineering' },
        },
      },
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      class_mentors: { findMany: jest.fn(), findFirst: jest.fn() },
      campus_outing_requests: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CampusOutingRequestsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CampusOutingRequestsService>(
      CampusOutingRequestsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('throws 404 when the caller has no faculty profile', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(
        service.findAll(
          { limit: 20, page: 1 } as any,
          { sub: 1, role: 'faculty' } as any,
        ),
      ).rejects.toThrow('Faculty profile not found for the authenticated user');
    });

    it('returns an empty page (not an error) when the faculty mentors no class', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.class_mentors.findMany.mockResolvedValue([]);

      const result = await service.findAll(
        { limit: 20, page: 1 } as any,
        { sub: 1, role: 'faculty' } as any,
      );

      expect(result.data).toEqual([]);
      expect(result.meta.total).toBe(0);
      expect(prisma.campus_outing_requests.findMany).not.toHaveBeenCalled();
    });

    it('scopes the query to classes the faculty mentors, and includes start_time/return_time', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.class_mentors.findMany.mockResolvedValue([{ class_id: 5 }]);
      prisma.campus_outing_requests.findMany.mockResolvedValue([outingRow()]);
      prisma.campus_outing_requests.count.mockResolvedValue(1);

      const result = await service.findAll(
        { limit: 20, page: 1 } as any,
        { sub: 1, role: 'faculty' } as any,
      );

      const [findManyArgs] = prisma.campus_outing_requests.findMany.mock
        .calls[0] as [{ where: Record<string, unknown> }];
      expect(findManyArgs.where).toMatchObject({
        students: { class_id: { in: [5] } },
      });
      expect(result.data[0]).toMatchObject({
        id: 1,
        start_time: '09:00',
        return_time: '17:00',
        student: { name: 'Arjun Kumar' },
      });
    });
  });

  describe('facultyApprove', () => {
    it("throws 403 NOT_THE_MENTOR when the caller does not mentor this student's class", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.campus_outing_requests.findUnique.mockResolvedValue({
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

    it('throws 422 ALREADY_DECIDED when the outing request is not still pending', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.campus_outing_requests.findUnique.mockResolvedValue({
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

    it('throws 404 OUTING_REQUEST_NOT_FOUND when no row exists with this id', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.campus_outing_requests.findUnique.mockResolvedValue(null);

      await expect(
        service.facultyApprove(1, { decision: 'approved' }, 1),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'OUTING_REQUEST_NOT_FOUND' },
      });
    });

    it('sets status to faculty_approved and records approved_by_faculty_id on approve', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.campus_outing_requests.findUnique.mockResolvedValue({
        status: 'pending',
        students: { class_id: 5 },
      });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.campus_outing_requests.update.mockResolvedValue(
        outingRow({ status: 'faculty_approved' }),
      );

      await service.facultyApprove(1, { decision: 'approved' }, 1);

      expect(prisma.campus_outing_requests.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'faculty_approved', approved_by_faculty_id: 7 },
        select: expect.any(Object),
      });
    });

    it('short-circuits straight to rejected on reject, without setting approved_by_faculty_id', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.campus_outing_requests.findUnique.mockResolvedValue({
        status: 'pending',
        students: { class_id: 5 },
      });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.campus_outing_requests.update.mockResolvedValue(
        outingRow({ status: 'rejected' }),
      );

      await service.facultyApprove(1, { decision: 'rejected' }, 1);

      expect(prisma.campus_outing_requests.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'rejected' },
        select: expect.any(Object),
      });
    });
  });

  describe('hodApprove', () => {
    it('throws 404 OUTING_REQUEST_NOT_FOUND when no row exists with this id', async () => {
      prisma.campus_outing_requests.findUnique.mockResolvedValue(null);

      await expect(
        service.hodApprove(1, { decision: 'approved' }, 99),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'OUTING_REQUEST_NOT_FOUND' },
      });
    });

    it('throws 422 NOT_FACULTY_APPROVED_YET when still pending', async () => {
      prisma.campus_outing_requests.findUnique.mockResolvedValue({
        status: 'pending',
      });

      await expect(
        service.hodApprove(1, { decision: 'approved' }, 99),
      ).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'NOT_FACULTY_APPROVED_YET' },
      });
    });

    it('throws 422 ALREADY_DECIDED when already hod_approved/rejected', async () => {
      prisma.campus_outing_requests.findUnique.mockResolvedValue({
        status: 'rejected',
      });

      await expect(
        service.hodApprove(1, { decision: 'approved' }, 99),
      ).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'ALREADY_DECIDED' },
      });
    });

    it('sets status to hod_approved and records approved_by_hod_user_id on approve', async () => {
      prisma.campus_outing_requests.findUnique.mockResolvedValue({
        status: 'faculty_approved',
      });
      prisma.campus_outing_requests.update.mockResolvedValue(
        outingRow({ status: 'hod_approved' }),
      );

      await service.hodApprove(1, { decision: 'approved' }, 99);

      expect(prisma.campus_outing_requests.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'hod_approved', approved_by_hod_user_id: 99 },
        select: expect.any(Object),
      });
    });
  });
});
