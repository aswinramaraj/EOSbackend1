import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeOdTeamsListService } from './me-od-teams-list.service';

describe('MeOdTeamsListService', () => {
  let service: MeOdTeamsListService;
  let prisma: {
    students: { findUnique: jest.Mock };
    od_team_members: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      od_team_members: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeOdTeamsListService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeOdTeamsListService>(MeOdTeamsListService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);

    await expect(service.getMyOdTeams(999)).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
  });

  it('scopes the query to memberships for the resolved student_id', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.od_team_members.findMany.mockResolvedValue([]);

    await service.getMyOdTeams(1);

    const [findManyArgs] = prisma.od_team_members.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(findManyArgs.where).toEqual({ student_id: 42 });
  });

  it('marks is_creator true and has_request true when an od_request already exists', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.od_team_members.findMany.mockResolvedValue([
      {
        joined_at: new Date('2026-07-01T00:00:00.000Z'),
        od_teams: {
          id: 3,
          unique_code: 'ABC123',
          is_locked: true,
          created_by_student_id: 42,
          created_at: new Date('2026-06-30T00:00:00.000Z'),
          team_name: 'Robotics workshop team',
          reason: 'Inter-college robotics workshop',
          venue: 'PSG Tech, Coimbatore',
          from_date: new Date('2026-07-05T00:00:00.000Z'),
          to_date: new Date('2026-07-06T00:00:00.000Z'),
          from_time: new Date('1970-01-01T09:00:00.000Z'),
          to_time: new Date('1970-01-01T17:00:00.000Z'),
          faculty_guide_id: 11,
          faculty: { first_name: 'Ramesh', last_name: 'Kumar' },
          od_team_members: [
            {
              student_id: 42,
              joined_at: new Date('2026-06-30T00:00:00.000Z'),
              students: {
                student_id_no: '23IT017',
                soa_applications: { first_name: 'Vignesh', last_name: 'K' },
              },
            },
            {
              student_id: 43,
              joined_at: new Date('2026-07-01T00:00:00.000Z'),
              students: { student_id_no: '23IT018', soa_applications: null },
            },
          ],
          od_requests: [{ id: 7 }],
        },
      },
    ]);

    const result = await service.getMyOdTeams(1);

    expect(result.data).toEqual([
      {
        id: 3,
        unique_code: 'ABC123',
        is_locked: true,
        team_name: 'Robotics workshop team',
        reason: 'Inter-college robotics workshop',
        venue: 'PSG Tech, Coimbatore',
        from_date: '2026-07-05',
        to_date: '2026-07-06',
        from_time: '09:00',
        to_time: '17:00',
        faculty_guide_id: 11,
        faculty_guide_name: 'Ramesh Kumar',
        is_creator: true,
        member_count: 2,
        members: [
          { student_id: 42, name: 'Vignesh K', is_creator: true, joined_at: '2026-06-30T00:00:00.000Z' },
          { student_id: 43, name: '23IT018', is_creator: false, joined_at: '2026-07-01T00:00:00.000Z' },
        ],
        joined_at: '2026-07-01T00:00:00.000Z',
        created_at: '2026-06-30T00:00:00.000Z',
        has_request: true,
        od_request_id: 7,
      },
    ]);
  });

  it('marks is_creator false and has_request false for a joined, unlocked team with no request yet', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.od_team_members.findMany.mockResolvedValue([
      {
        joined_at: new Date('2026-07-01T00:00:00.000Z'),
        od_teams: {
          id: 5,
          unique_code: 'XYZ999',
          is_locked: false,
          created_by_student_id: 99,
          created_at: new Date('2026-07-01T00:00:00.000Z'),
          od_team_members: [
            {
              student_id: 42,
              joined_at: new Date('2026-07-01T00:00:00.000Z'),
              students: { student_id_no: '23IT017', soa_applications: null },
            },
            {
              student_id: 99,
              joined_at: new Date('2026-07-01T00:00:00.000Z'),
              students: { student_id_no: '23IT001', soa_applications: null },
            },
          ],
          od_requests: [],
        },
      },
    ]);

    const result = await service.getMyOdTeams(1);

    expect(result.data[0]).toMatchObject({
      is_creator: false,
      has_request: false,
      od_request_id: null,
    });
    expect(result.data[0].members).toEqual([
      { student_id: 42, name: '23IT017', is_creator: false, joined_at: '2026-07-01T00:00:00.000Z' },
      { student_id: 99, name: '23IT001', is_creator: true, joined_at: '2026-07-01T00:00:00.000Z' },
    ]);
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.od_team_members.findMany.mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(service.getMyOdTeams(1)).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });
});
