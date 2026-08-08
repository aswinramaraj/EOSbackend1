jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { StudentOdsService } from './student-ods.service';

describe('StudentOdsService', () => {
  let service: StudentOdsService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    class_mentors: { findMany: jest.Mock; findFirst: jest.Mock };
    od_requests: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  function odRequestRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      team_id: 10,
      from_date: new Date('2026-08-20T00:00:00.000Z'),
      to_date: new Date('2026-08-20T00:00:00.000Z'),
      from_time: null,
      to_time: null,
      reason: 'IEEE paper presentation',
      mentor_approval_status: 'pending',
      created_at: new Date('2026-08-10T00:00:00.000Z'),
      faculty: { first_name: 'Kavitha', last_name: 'R' },
      od_teams: {
        unique_code: 'H7QR4A',
        od_team_members: [{ student_id: 42 }, { student_id: 43 }],
        students: {
          id: 42,
          student_id_no: '23EC056',
          class_id: 5,
          soa_applications: { first_name: 'Arjun', last_name: 'Kumar' },
          users: { id: 100, email: 'arjun@sece.ac.in' },
          classes: { section: 'B', departments: { name: 'Electronics Engineering' } },
        },
      },
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      class_mentors: { findMany: jest.fn(), findFirst: jest.fn() },
      od_requests: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentOdsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<StudentOdsService>(StudentOdsService);
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
      expect(prisma.od_requests.findMany).not.toHaveBeenCalled();
    });

    it("scopes the query to the mentored classes via the request's team creator", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.class_mentors.findMany.mockResolvedValue([
        { class_id: 5 },
        { class_id: 9 },
      ]);
      prisma.od_requests.findMany.mockResolvedValue([odRequestRow()]);
      prisma.od_requests.count.mockResolvedValue(1);

      const result = await service.findAll(
        { limit: 20, page: 1, skip: 0 } as any,
        1,
      );

      const [findManyArgs] = prisma.od_requests.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(findManyArgs.where).toMatchObject({
        od_teams: { students: { class_id: { in: [5, 9] } } },
      });
      expect(result.data[0]).toMatchObject({
        id: 1,
        unique_code: 'H7QR4A',
        member_count: 2,
        creator: {
          id: 42,
          student_id_no: '23EC056',
          name: 'Arjun Kumar',
          section: 'B',
          department_name: 'Electronics Engineering',
        },
        faculty_guide_name: 'Kavitha R',
        mentor_approval_status: 'pending',
      });
    });

    it('resolves null faculty_guide_name when no guide was picked, and falls back to email for the creator name', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.class_mentors.findMany.mockResolvedValue([{ class_id: 5 }]);
      prisma.od_requests.findMany.mockResolvedValue([
        odRequestRow({
          faculty: null,
          od_teams: {
            unique_code: 'H7QR4A',
            od_team_members: [{ student_id: 42 }],
            students: {
              id: 42,
              student_id_no: '23EC056',
              class_id: null,
              soa_applications: null,
              users: { id: 100, email: 'arjun@sece.ac.in' },
              classes: null,
            },
          },
        }),
      ]);
      prisma.od_requests.count.mockResolvedValue(1);

      const result = await service.findAll({ limit: 20, page: 1 } as any, 1);

      expect(result.data[0]).toMatchObject({
        faculty_guide_name: null,
        creator: { name: 'arjun@sece.ac.in', section: null, department_name: null },
      });
    });
  });

  describe('facultyApprove', () => {
    it("throws 403 NOT_THE_MENTOR when the caller does not mentor the creator's class", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_requests.findUnique.mockResolvedValue({
        mentor_approval_status: 'pending',
        od_teams: { students: { class_id: 5 } },
      });
      prisma.class_mentors.findFirst.mockResolvedValue(null);

      await expect(
        service.facultyApprove(1, { decision: 'approved' }, 1),
      ).rejects.toMatchObject({
        status: 403,
        response: { errorCode: 'NOT_THE_MENTOR' },
      });
    });

    it('throws 404 OD_REQUEST_NOT_FOUND when the id does not match any request', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_requests.findUnique.mockResolvedValue(null);

      await expect(
        service.facultyApprove(999, { decision: 'approved' }, 1),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'OD_REQUEST_NOT_FOUND' },
      });
    });

    it('throws 422 ALREADY_DECIDED when the request is not still pending', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_requests.findUnique.mockResolvedValue({
        mentor_approval_status: 'approved',
        od_teams: { students: { class_id: 5 } },
      });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });

      await expect(
        service.facultyApprove(1, { decision: 'approved' }, 1),
      ).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'ALREADY_DECIDED' },
      });
    });

    it('sets mentor_approval_status to approved on approve', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_requests.findUnique.mockResolvedValue({
        mentor_approval_status: 'pending',
        od_teams: { students: { class_id: 5 } },
      });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.od_requests.update.mockResolvedValue(odRequestRow({ mentor_approval_status: 'approved' }));

      await service.facultyApprove(1, { decision: 'approved' }, 1);

      expect(prisma.od_requests.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { mentor_approval_status: 'approved' },
        select: expect.any(Object),
      });
    });

    it('sets mentor_approval_status to rejected on reject', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_requests.findUnique.mockResolvedValue({
        mentor_approval_status: 'pending',
        od_teams: { students: { class_id: 5 } },
      });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.od_requests.update.mockResolvedValue(odRequestRow({ mentor_approval_status: 'rejected' }));

      await service.facultyApprove(1, { decision: 'rejected' }, 1);

      expect(prisma.od_requests.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { mentor_approval_status: 'rejected' },
        select: expect.any(Object),
      });
    });
  });
});
