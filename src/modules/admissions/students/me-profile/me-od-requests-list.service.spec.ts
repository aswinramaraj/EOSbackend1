import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeOdRequestsListService } from './me-od-requests-list.service';

describe('MeOdRequestsListService', () => {
  let service: MeOdRequestsListService;
  let prisma: {
    students: { findUnique: jest.Mock };
    od_requests: { count: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      od_requests: { count: jest.fn(), findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeOdRequestsListService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeOdRequestsListService>(MeOdRequestsListService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);

    await expect(
      service.getMyOdRequests(999, { page: 1, page_size: 20 }),
    ).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
  });

  it('scopes the query to teams the caller is a member of, with pagination', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.od_requests.count.mockResolvedValue(0);
    prisma.od_requests.findMany.mockResolvedValue([]);

    await service.getMyOdRequests(1, { page: 2, page_size: 10 });

    const [findManyArgs] = prisma.od_requests.findMany.mock.calls[0] as [
      { where: Record<string, unknown>; skip: number; take: number },
    ];
    expect(findManyArgs.where).toEqual({
      od_teams: { od_team_members: { some: { student_id: 42 } } },
    });
    expect(findManyArgs.skip).toBe(10);
    expect(findManyArgs.take).toBe(10);
  });

  it('computes overall_status and per-request approval counts', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.od_requests.count.mockResolvedValue(1);
    prisma.od_requests.findMany.mockResolvedValue([
      {
        id: 7,
        team_id: 3,
        from_date: new Date('2026-08-01T00:00:00.000Z'),
        to_date: new Date('2026-08-02T00:00:00.000Z'),
        reason: 'Hackathon',
        mentor_approval_status: 'approved',
        created_at: new Date('2026-07-20T00:00:00.000Z'),
        od_teams: { unique_code: 'ABC123' },
        od_request_hod_approvals: [
          { status: 'approved' },
          { status: 'pending' },
        ],
      },
    ]);

    const result = await service.getMyOdRequests(1, {
      page: 1,
      page_size: 20,
    });

    expect(result.data).toEqual([
      {
        id: 7,
        team_id: 3,
        unique_code: 'ABC123',
        from_date: '2026-08-01',
        to_date: '2026-08-02',
        from_time: null,
        to_time: null,
        reason: 'Hackathon',
        faculty_guide_name: null,
        mentor_approval_status: 'approved',
        overall_status: 'pending_hod',
        member_count: 2,
        approved_count: 1,
        rejected_count: 0,
        pending_count: 1,
        created_at: '2026-07-20T00:00:00.000Z',
      },
    ]);
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(20);
    expect(result.total).toBe(1);
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.od_requests.count.mockRejectedValue(new Error('connection lost'));

    await expect(
      service.getMyOdRequests(1, { page: 1, page_size: 20 }),
    ).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });
});
