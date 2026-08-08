import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeOdRequestsService } from './me-od-requests.service';

describe('MeOdRequestsService', () => {
  let service: MeOdRequestsService;
  let prisma: {
    students: { findUnique: jest.Mock };
    od_requests: { findUnique: jest.Mock };
    od_team_members: { findUnique: jest.Mock };
    od_request_hod_approvals: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      od_requests: { findUnique: jest.fn() },
      od_team_members: { findUnique: jest.fn() },
      od_request_hod_approvals: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeOdRequestsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeOdRequestsService>(MeOdRequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('resolves a real name via soa_applications when available, and falls back to student_id_no otherwise', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 7 });
    prisma.od_requests.findUnique.mockResolvedValue({
      id: 61,
      team_id: 61,
      from_date: new Date('2099-08-12T00:00:00.000Z'),
      to_date: new Date('2099-08-13T00:00:00.000Z'),
      reason: 'Inter-college hackathon',
      mentor_approval_status: 'approved',
    });
    prisma.od_team_members.findUnique.mockResolvedValue({ id: 1 });
    prisma.od_request_hod_approvals.findMany.mockResolvedValue([
      {
        student_id: 4,
        department_id: 3,
        status: 'approved',
        reviewed_at: new Date('2026-07-25T09:00:00.000Z'),
        students: {
          student_id_no: 'AIDS2026042',
          soa_applications: { first_name: 'Arjun', last_name: 'Kumar' },
        },
        departments: { name: 'AI & DS' },
        users: { email: 'hod.aids@eos.test' },
      },
      {
        student_id: 8,
        department_id: 1,
        status: 'pending',
        reviewed_at: null,
        students: {
          student_id_no: 'TEST-ME-PROFILE-002',
          soa_applications: null,
        },
        departments: { name: 'Computer Science and Engineering' },
        users: null,
      },
    ]);

    const result = await service.getOdRequestStatus(103, 61);

    expect(prisma.od_team_members.findUnique).toHaveBeenCalledWith({
      where: { team_id_student_id: { team_id: 61, student_id: 7 } },
    });
    expect(result).toEqual({
      id: 61,
      team_id: 61,
      from_date: '2099-08-12',
      to_date: '2099-08-13',
      from_time: null,
      to_time: null,
      faculty_guide_name: null,
      reason: 'Inter-college hackathon',
      mentor_approval_status: 'approved',
      overall_status: 'pending_hod',
      member_approvals: [
        {
          student_id: 4,
          student_name: 'Arjun Kumar',
          department_id: 3,
          department_name: 'AI & DS',
          status: 'approved',
          hod_name: 'hod.aids@eos.test',
          reviewed_at: '2026-07-25T09:00:00.000Z',
        },
        {
          student_id: 8,
          student_name: 'TEST-ME-PROFILE-002',
          department_id: 1,
          department_name: 'Computer Science and Engineering',
          status: 'pending',
          hod_name: null,
          reviewed_at: null,
        },
      ],
    });
  });

  it('formats from_time/to_time as HH:mm when set', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 7 });
    prisma.od_requests.findUnique.mockResolvedValue({
      id: 61,
      team_id: 61,
      from_date: new Date('2099-08-12T00:00:00.000Z'),
      to_date: new Date('2099-08-13T00:00:00.000Z'),
      from_time: new Date('1970-01-01T09:30:00.000Z'),
      to_time: new Date('1970-01-01T17:00:00.000Z'),
      reason: null,
      mentor_approval_status: 'approved',
    });
    prisma.od_team_members.findUnique.mockResolvedValue({ id: 1 });
    prisma.od_request_hod_approvals.findMany.mockResolvedValue([]);

    const result = await service.getOdRequestStatus(103, 61);

    expect(result.from_time).toBe('09:30');
    expect(result.to_time).toBe('17:00');
  });

  describe('overall_status precedence', () => {
    const baseRequest = {
      id: 61,
      team_id: 61,
      from_date: new Date('2099-08-12T00:00:00.000Z'),
      to_date: new Date('2099-08-13T00:00:00.000Z'),
      reason: null,
    };

    beforeEach(() => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_team_members.findUnique.mockResolvedValue({ id: 1 });
    });

    it('is pending_mentor when the mentor has not approved, regardless of HOD rows', async () => {
      prisma.od_requests.findUnique.mockResolvedValue({
        ...baseRequest,
        mentor_approval_status: 'pending',
      });
      prisma.od_request_hod_approvals.findMany.mockResolvedValue([
        {
          student_id: 7,
          department_id: 1,
          status: 'approved',
          reviewed_at: new Date(),
          students: { student_id_no: 'X', soa_applications: null },
          departments: { name: 'CSE' },
          users: { email: 'hod@eos.test' },
        },
      ]);

      const result = await service.getOdRequestStatus(103, 61);
      expect(result.overall_status).toBe('pending_mentor');
    });

    it('is rejected when any department is rejected, even if another is still pending (rejected takes precedence over pending)', async () => {
      prisma.od_requests.findUnique.mockResolvedValue({
        ...baseRequest,
        mentor_approval_status: 'approved',
      });
      prisma.od_request_hod_approvals.findMany.mockResolvedValue([
        {
          student_id: 7,
          department_id: 1,
          status: 'rejected',
          reviewed_at: new Date(),
          students: { student_id_no: 'X', soa_applications: null },
          departments: { name: 'CSE' },
          users: { email: 'hod@eos.test' },
        },
        {
          student_id: 8,
          department_id: 2,
          status: 'pending',
          reviewed_at: null,
          students: { student_id_no: 'Y', soa_applications: null },
          departments: { name: 'Mechanical' },
          users: null,
        },
      ]);

      const result = await service.getOdRequestStatus(103, 61);
      expect(result.overall_status).toBe('rejected');
    });

    it('is pending_hod when mentor approved and at least one department is still pending (no rejections)', async () => {
      prisma.od_requests.findUnique.mockResolvedValue({
        ...baseRequest,
        mentor_approval_status: 'approved',
      });
      prisma.od_request_hod_approvals.findMany.mockResolvedValue([
        {
          student_id: 7,
          department_id: 1,
          status: 'approved',
          reviewed_at: new Date(),
          students: { student_id_no: 'X', soa_applications: null },
          departments: { name: 'CSE' },
          users: { email: 'hod@eos.test' },
        },
        {
          student_id: 8,
          department_id: 2,
          status: 'pending',
          reviewed_at: null,
          students: { student_id_no: 'Y', soa_applications: null },
          departments: { name: 'Mechanical' },
          users: null,
        },
      ]);

      const result = await service.getOdRequestStatus(103, 61);
      expect(result.overall_status).toBe('pending_hod');
    });

    it('is approved when mentor approved and every department approved', async () => {
      prisma.od_requests.findUnique.mockResolvedValue({
        ...baseRequest,
        mentor_approval_status: 'approved',
      });
      prisma.od_request_hod_approvals.findMany.mockResolvedValue([
        {
          student_id: 7,
          department_id: 1,
          status: 'approved',
          reviewed_at: new Date(),
          students: { student_id_no: 'X', soa_applications: null },
          departments: { name: 'CSE' },
          users: { email: 'hod@eos.test' },
        },
      ]);

      const result = await service.getOdRequestStatus(103, 61);
      expect(result.overall_status).toBe('approved');
    });

    it('is approved (vacuously) when mentor approved and there are zero member_approvals rows', async () => {
      prisma.od_requests.findUnique.mockResolvedValue({
        ...baseRequest,
        mentor_approval_status: 'approved',
      });
      prisma.od_request_hod_approvals.findMany.mockResolvedValue([]);

      const result = await service.getOdRequestStatus(103, 61);
      expect(result.overall_status).toBe('approved');
      expect(result.member_approvals).toEqual([]);
    });
  });

  it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);

    await expect(service.getOdRequestStatus(999, 61)).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
    expect(prisma.od_requests.findUnique).not.toHaveBeenCalled();
  });

  it('throws 404 OD_REQUEST_NOT_FOUND when id matches no request', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 7 });
    prisma.od_requests.findUnique.mockResolvedValue(null);

    await expect(service.getOdRequestStatus(103, 999)).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'OD_REQUEST_NOT_FOUND' },
    });
    expect(prisma.od_team_members.findUnique).not.toHaveBeenCalled();
  });

  it('throws 403 NOT_A_TEAM_MEMBER when the caller is not on the request team', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 9 });
    prisma.od_requests.findUnique.mockResolvedValue({
      id: 61,
      team_id: 61,
      from_date: new Date(),
      to_date: new Date(),
      reason: null,
      mentor_approval_status: 'pending',
    });
    prisma.od_team_members.findUnique.mockResolvedValue(null);

    await expect(service.getOdRequestStatus(555, 61)).rejects.toMatchObject({
      status: 403,
      response: { errorCode: 'NOT_A_TEAM_MEMBER' },
    });
    expect(prisma.od_request_hod_approvals.findMany).not.toHaveBeenCalled();
  });

  it('wraps a DB failure fetching approvals as 500 INTERNAL_ERROR', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 7 });
    prisma.od_requests.findUnique.mockResolvedValue({
      id: 61,
      team_id: 61,
      from_date: new Date(),
      to_date: new Date(),
      reason: null,
      mentor_approval_status: 'pending',
    });
    prisma.od_team_members.findUnique.mockResolvedValue({ id: 1 });
    prisma.od_request_hod_approvals.findMany.mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(service.getOdRequestStatus(103, 61)).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });
});
