import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { MeOdTeamsService } from './me-od-teams.service';

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

const VALID_CREATE_DTO = {
  team_name: 'Team Nexus',
  reason: 'IEEE paper presentation',
  venue: 'Anna University, Chennai',
  from_date: '2999-01-10',
  to_date: '2999-01-12',
  from_time: '09:00',
  to_time: '17:00',
  faculty_guide_id: 41,
};

describe('MeOdTeamsService', () => {
  let service: MeOdTeamsService;
  let notifications: { notify: jest.Mock };
  let tx: {
    od_teams: { create: jest.Mock; updateMany: jest.Mock };
    od_team_members: { create: jest.Mock };
    od_requests: { create: jest.Mock };
    od_request_hod_approvals: { createMany: jest.Mock };
  };
  let prisma: {
    students: { findUnique: jest.Mock; findMany: jest.Mock };
    od_teams: { findUnique: jest.Mock };
    od_team_members: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
    faculty: { findUnique: jest.Mock };
    class_mentors: { findFirst: jest.Mock };
    departments: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = {
      od_teams: {
        create: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      od_team_members: { create: jest.fn() },
      od_requests: { create: jest.fn() },
      od_request_hod_approvals: { createMany: jest.fn() },
    };
    prisma = {
      students: { findUnique: jest.fn(), findMany: jest.fn() },
      od_teams: { findUnique: jest.fn() },
      od_team_members: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      faculty: { findUnique: jest.fn() },
      class_mentors: { findFirst: jest.fn() },
      departments: { findUnique: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };
    notifications = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeOdTeamsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<MeOdTeamsService>(MeOdTeamsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a team and auto-joins the creator as its first member, in one transaction', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 3310 });
    prisma.faculty.findUnique.mockResolvedValue({ first_name: 'Kavitha', last_name: 'R' });
    tx.od_teams.create.mockResolvedValue({
      id: 61,
      created_by_student_id: 3310,
      unique_code: 'X7K9QT',
      is_locked: false,
      created_at: new Date('2026-07-26T10:15:00.000Z'),
      team_name: VALID_CREATE_DTO.team_name,
      reason: VALID_CREATE_DTO.reason,
      venue: VALID_CREATE_DTO.venue,
      from_date: new Date(VALID_CREATE_DTO.from_date),
      to_date: new Date(VALID_CREATE_DTO.to_date),
      from_time: new Date('1970-01-01T09:00:00.000Z'),
      to_time: new Date('1970-01-01T17:00:00.000Z'),
      faculty_guide_id: 41,
    });
    tx.od_team_members.create.mockResolvedValue({
      id: 1,
      team_id: 61,
      student_id: 3310,
    });

    const result = await service.createOdTeam(7, VALID_CREATE_DTO);

    expect(prisma.students.findUnique).toHaveBeenCalledWith({
      where: { user_id: 7 },
      select: { id: true },
    });

    const [teamCreateArgs] = tx.od_teams.create.mock.calls[0] as [
      {
        data: {
          created_by_student_id: number;
          unique_code: string;
          is_locked: boolean;
          team_name: string;
          faculty_guide_id: number;
        };
      },
    ];
    expect(teamCreateArgs.data.created_by_student_id).toBe(3310);
    expect(teamCreateArgs.data.is_locked).toBe(false);
    expect(teamCreateArgs.data.team_name).toBe('Team Nexus');
    expect(teamCreateArgs.data.faculty_guide_id).toBe(41);
    expect(teamCreateArgs.data.unique_code).toHaveLength(6);
    for (const char of teamCreateArgs.data.unique_code) {
      expect(CODE_ALPHABET).toContain(char);
    }

    const [memberCreateArgs] = tx.od_team_members.create.mock.calls[0] as [
      { data: { team_id: number; student_id: number } },
    ];
    expect(memberCreateArgs.data).toEqual({ team_id: 61, student_id: 3310 });

    expect(result).toEqual({
      id: 61,
      created_by_student_id: 3310,
      unique_code: 'X7K9QT',
      is_locked: false,
      created_at: new Date('2026-07-26T10:15:00.000Z'),
      team_name: 'Team Nexus',
      reason: 'IEEE paper presentation',
      venue: 'Anna University, Chennai',
      from_date: '2999-01-10',
      to_date: '2999-01-12',
      from_time: '09:00',
      to_time: '17:00',
      faculty_guide_id: 41,
      faculty_guide_name: 'Kavitha R',
    });
  });

  it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);

    await expect(
      service.createOdTeam(999, VALID_CREATE_DTO),
    ).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('retries with a freshly generated unique_code on a P2002 collision', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 3310 });
    prisma.faculty.findUnique.mockResolvedValue({ first_name: 'Kavitha', last_name: 'R' });
    const conflict = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    prisma.$transaction
      .mockImplementationOnce(() => Promise.reject(conflict))
      .mockImplementationOnce((cb: (tx: unknown) => unknown) => cb(tx));
    tx.od_teams.create.mockResolvedValue({
      id: 62,
      created_by_student_id: 3310,
      unique_code: 'ABCDEF',
      is_locked: false,
      created_at: new Date(),
      team_name: VALID_CREATE_DTO.team_name,
      reason: VALID_CREATE_DTO.reason,
      venue: VALID_CREATE_DTO.venue,
      from_date: new Date(VALID_CREATE_DTO.from_date),
      to_date: new Date(VALID_CREATE_DTO.to_date),
      from_time: new Date('1970-01-01T09:00:00.000Z'),
      to_time: new Date('1970-01-01T17:00:00.000Z'),
      faculty_guide_id: 41,
    });
    tx.od_team_members.create.mockResolvedValue({});

    const result = await service.createOdTeam(7, VALID_CREATE_DTO);

    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(result.id).toBe(62);
  });

  it('gives up and throws 500 INTERNAL_ERROR after exhausting all retry attempts on repeated collisions', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 3310 });
    prisma.faculty.findUnique.mockResolvedValue({ first_name: 'Kavitha', last_name: 'R' });
    const conflict = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    prisma.$transaction.mockImplementation(() => Promise.reject(conflict));

    await expect(
      service.createOdTeam(7, VALID_CREATE_DTO),
    ).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(5);
  });

  it('wraps a non-collision DB failure as 500 INTERNAL_ERROR without retrying', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 3310 });
    prisma.faculty.findUnique.mockResolvedValue({ first_name: 'Kavitha', last_name: 'R' });
    prisma.$transaction.mockRejectedValue(new Error('connection lost'));

    await expect(
      service.createOdTeam(7, VALID_CREATE_DTO),
    ).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  describe('joinOdTeam', () => {
    it('joins an unlocked team and returns an enriched, nested response', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 8 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        unique_code: 'X7K9QT',
        is_locked: false,
      });
      prisma.od_team_members.findUnique.mockResolvedValue(null);
      prisma.od_team_members.create.mockResolvedValue({
        id: 145,
        team_id: 61,
        student_id: 8,
        joined_at: new Date('2026-07-26T10:20:00.000Z'),
      });

      const result = await service.joinOdTeam(103, { unique_code: 'X7K9QT' });

      expect(prisma.od_teams.findUnique).toHaveBeenCalledWith({
        where: { unique_code: 'X7K9QT' },
        select: { id: true, unique_code: true, is_locked: true },
      });
      expect(prisma.od_team_members.findUnique).toHaveBeenCalledWith({
        where: { team_id_student_id: { team_id: 61, student_id: 8 } },
      });
      expect(prisma.od_team_members.create).toHaveBeenCalledWith({
        data: { team_id: 61, student_id: 8 },
      });
      expect(result).toEqual({
        id: 145,
        team_id: 61,
        student_id: 8,
        joined_at: new Date('2026-07-26T10:20:00.000Z'),
        team: { unique_code: 'X7K9QT', is_locked: false },
      });
    });

    it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(
        service.joinOdTeam(999, { unique_code: 'X7K9QT' }),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'STUDENT_NOT_FOUND' },
      });
      expect(prisma.od_teams.findUnique).not.toHaveBeenCalled();
    });

    it('throws 404 TEAM_NOT_FOUND when unique_code matches no team', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 8 });
      prisma.od_teams.findUnique.mockResolvedValue(null);

      await expect(
        service.joinOdTeam(103, { unique_code: 'NOTREAL' }),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'TEAM_NOT_FOUND' },
      });
      expect(prisma.od_team_members.findUnique).not.toHaveBeenCalled();
    });

    it('throws 422 TEAM_LOCKED when the team is locked', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 8 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        unique_code: 'X7K9QT',
        is_locked: true,
      });

      await expect(
        service.joinOdTeam(103, { unique_code: 'X7K9QT' }),
      ).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'TEAM_LOCKED' },
      });
      expect(prisma.od_team_members.findUnique).not.toHaveBeenCalled();
      expect(prisma.od_team_members.create).not.toHaveBeenCalled();
    });

    it('throws 409 ALREADY_A_MEMBER via the pre-check when already a member', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 8 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        unique_code: 'X7K9QT',
        is_locked: false,
      });
      prisma.od_team_members.findUnique.mockResolvedValue({
        id: 90,
        team_id: 61,
        student_id: 8,
      });

      await expect(
        service.joinOdTeam(103, { unique_code: 'X7K9QT' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'ALREADY_A_MEMBER' },
      });
      expect(prisma.od_team_members.create).not.toHaveBeenCalled();
    });

    it('throws 409 ALREADY_A_MEMBER via the P2002 backstop when a race slips past the pre-check', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 8 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        unique_code: 'X7K9QT',
        is_locked: false,
      });
      prisma.od_team_members.findUnique.mockResolvedValue(null);
      const conflict = Object.assign(new Error('Unique constraint failed'), {
        code: 'P2002',
      });
      prisma.od_team_members.create.mockRejectedValue(conflict);

      await expect(
        service.joinOdTeam(103, { unique_code: 'X7K9QT' }),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'ALREADY_A_MEMBER' },
      });
    });

    it('wraps a non-collision DB failure on insert as 500 INTERNAL_ERROR', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 8 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        unique_code: 'X7K9QT',
        is_locked: false,
      });
      prisma.od_team_members.findUnique.mockResolvedValue(null);
      prisma.od_team_members.create.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        service.joinOdTeam(103, { unique_code: 'X7K9QT' }),
      ).rejects.toMatchObject({
        status: 500,
        response: { errorCode: 'INTERNAL_ERROR' },
      });
    });
  });

  describe('removeOdTeamMember', () => {
    it('creator removes another member and gets an enriched confirmation', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
      });
      const joinedAt = new Date('2026-07-26T10:20:00.000Z');
      prisma.od_team_members.findUnique.mockResolvedValue({
        id: 145,
        team_id: 61,
        student_id: 8,
        joined_at: joinedAt,
      });
      prisma.od_team_members.delete.mockResolvedValue({});

      const result = await service.removeOdTeamMember(103, 61, 8);

      expect(prisma.od_teams.findUnique).toHaveBeenCalledWith({
        where: { id: 61 },
        select: { id: true, created_by_student_id: true },
      });
      expect(prisma.od_team_members.findUnique).toHaveBeenCalledWith({
        where: { team_id_student_id: { team_id: 61, student_id: 8 } },
      });
      expect(prisma.od_team_members.delete).toHaveBeenCalledWith({
        where: { id: 145 },
      });
      expect(result.team_id).toBe(61);
      expect(result.student_id).toBe(8);
      expect(result.joined_at).toEqual(joinedAt);
      expect(result.removed_at).toBeInstanceOf(Date);
    });

    it('member removes themselves (not the creator)', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 8 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
      });
      prisma.od_team_members.findUnique.mockResolvedValue({
        id: 145,
        team_id: 61,
        student_id: 8,
        joined_at: new Date(),
      });
      prisma.od_team_members.delete.mockResolvedValue({});

      const result = await service.removeOdTeamMember(999, 61, 8);

      expect(result.student_id).toBe(8);
      expect(prisma.od_team_members.delete).toHaveBeenCalledWith({
        where: { id: 145 },
      });
    });

    it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(
        service.removeOdTeamMember(999, 61, 8),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'STUDENT_NOT_FOUND' },
      });
      expect(prisma.od_teams.findUnique).not.toHaveBeenCalled();
    });

    it('throws 404 TEAM_NOT_FOUND when id matches no team', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue(null);

      await expect(
        service.removeOdTeamMember(103, 999, 8),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'TEAM_NOT_FOUND' },
      });
      expect(prisma.od_team_members.findUnique).not.toHaveBeenCalled();
    });

    it('throws 403 NOT_AUTHORIZED_TO_REMOVE when caller is neither creator nor target', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 9 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
      });

      await expect(
        service.removeOdTeamMember(555, 61, 8),
      ).rejects.toMatchObject({
        status: 403,
        response: { errorCode: 'NOT_AUTHORIZED_TO_REMOVE' },
      });
      expect(prisma.od_team_members.findUnique).not.toHaveBeenCalled();
    });

    it('throws 404 MEMBER_NOT_FOUND via the pre-check when the target never joined', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
      });
      prisma.od_team_members.findUnique.mockResolvedValue(null);

      await expect(
        service.removeOdTeamMember(103, 61, 999),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'MEMBER_NOT_FOUND' },
      });
      expect(prisma.od_team_members.delete).not.toHaveBeenCalled();
    });

    it('throws 404 MEMBER_NOT_FOUND via the P2025 backstop when the row disappears before delete', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
      });
      prisma.od_team_members.findUnique.mockResolvedValue({
        id: 145,
        team_id: 61,
        student_id: 8,
        joined_at: new Date(),
      });
      const notFound = Object.assign(new Error('Record not found'), {
        code: 'P2025',
      });
      prisma.od_team_members.delete.mockRejectedValue(notFound);

      await expect(
        service.removeOdTeamMember(103, 61, 8),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'MEMBER_NOT_FOUND' },
      });
    });

    it('wraps a non-P2025 DB failure on delete as 500 INTERNAL_ERROR', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
      });
      prisma.od_team_members.findUnique.mockResolvedValue({
        id: 145,
        team_id: 61,
        student_id: 8,
        joined_at: new Date(),
      });
      prisma.od_team_members.delete.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(
        service.removeOdTeamMember(103, 61, 8),
      ).rejects.toMatchObject({
        status: 500,
        response: { errorCode: 'INTERNAL_ERROR' },
      });
    });
  });

  describe('submitOdRequest', () => {
    const validDto = {
      from_date: '2099-08-12',
      to_date: '2099-08-13',
      reason: 'Inter-college hackathon',
    };

    it('locks the team, fans out one approval row per member, and returns an enriched response', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
      });
      prisma.od_team_members.findMany.mockResolvedValue([
        { student_id: 7 },
        { student_id: 8 },
      ]);
      prisma.students.findMany.mockResolvedValue([
        {
          id: 7,
          classes: { department_id: 1, departments: { name: 'CSE' } },
        },
        {
          id: 8,
          classes: { department_id: 2, departments: { name: 'Mechanical' } },
        },
      ]);
      tx.od_requests.create.mockResolvedValue({
        id: 61,
        team_id: 61,
        from_date: new Date('2099-08-12T00:00:00.000Z'),
        to_date: new Date('2099-08-13T00:00:00.000Z'),
        reason: 'Inter-college hackathon',
        mentor_approval_status: 'pending',
      });
      tx.od_request_hod_approvals.createMany.mockResolvedValue({ count: 2 });

      const result = await service.submitOdRequest(103, 61, validDto);

      expect(prisma.od_team_members.findMany).toHaveBeenCalledWith({
        where: { team_id: 61 },
        select: { student_id: true },
      });
      const [createArgs] = tx.od_requests.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(createArgs.data).toMatchObject({
        team_id: 61,
        reason: 'Inter-college hackathon',
        mentor_approval_status: 'pending',
      });

      const [createManyArgs] = tx.od_request_hod_approvals.createMany.mock
        .calls[0] as [{ data: Record<string, unknown>[] }];
      expect(createManyArgs.data).toEqual([
        {
          od_request_id: 61,
          student_id: 7,
          department_id: 1,
          status: 'pending',
        },
        {
          od_request_id: 61,
          student_id: 8,
          department_id: 2,
          status: 'pending',
        },
      ]);

      expect(tx.od_teams.updateMany).toHaveBeenCalledWith({
        where: { id: 61, is_locked: false },
        data: { is_locked: true },
      });

      expect(result).toMatchObject({
        id: 61,
        team_id: 61,
        from_date: '2099-08-12',
        to_date: '2099-08-13',
        reason: 'Inter-college hackathon',
        mentor_approval_status: 'pending',
        hod_approvals: [
          {
            student_id: 7,
            department_id: 1,
            department_name: 'CSE',
            status: 'pending',
          },
          {
            student_id: 8,
            department_id: 2,
            department_name: 'Mechanical',
            status: 'pending',
          },
        ],
      });
    });

    it('resolves and persists faculty_guide_id, returning the guide name', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
      });
      prisma.od_team_members.findMany.mockResolvedValue([{ student_id: 7 }]);
      prisma.students.findMany.mockResolvedValue([
        { id: 7, classes: { department_id: 1, departments: { name: 'CSE' } } },
      ]);
      prisma.faculty.findUnique.mockResolvedValue({
        first_name: 'Kavitha',
        last_name: 'R',
      });
      tx.od_requests.create.mockResolvedValue({
        id: 61,
        team_id: 61,
        from_date: new Date('2099-08-12T00:00:00.000Z'),
        to_date: new Date('2099-08-13T00:00:00.000Z'),
        reason: 'Inter-college hackathon',
        faculty_guide_id: 12,
        mentor_approval_status: 'pending',
      });
      tx.od_request_hod_approvals.createMany.mockResolvedValue({ count: 1 });

      const result = await service.submitOdRequest(103, 61, {
        ...validDto,
        faculty_guide_id: 12,
      });

      expect(prisma.faculty.findUnique).toHaveBeenCalledWith({
        where: { id: 12 },
        select: { first_name: true, last_name: true },
      });
      const [createArgs] = tx.od_requests.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(createArgs.data).toMatchObject({ faculty_guide_id: 12 });
      expect(result).toMatchObject({
        faculty_guide_id: 12,
        faculty_guide_name: 'Kavitha R',
      });
    });

    it('throws 404 FACULTY_NOT_FOUND when faculty_guide_id does not match any faculty row', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
      });
      prisma.od_team_members.findMany.mockResolvedValue([{ student_id: 7 }]);
      prisma.students.findMany.mockResolvedValue([
        { id: 7, classes: { department_id: 1, departments: { name: 'CSE' } } },
      ]);
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(
        service.submitOdRequest(103, 61, { ...validDto, faculty_guide_id: 999 }),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'FACULTY_NOT_FOUND' },
      });
      expect(tx.od_requests.create).not.toHaveBeenCalled();
    });

    it('leaves faculty_guide_id/name null when omitted from the request', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
      });
      prisma.od_team_members.findMany.mockResolvedValue([{ student_id: 7 }]);
      prisma.students.findMany.mockResolvedValue([
        { id: 7, classes: { department_id: 1, departments: { name: 'CSE' } } },
      ]);
      tx.od_requests.create.mockResolvedValue({
        id: 61,
        team_id: 61,
        from_date: new Date('2099-08-12T00:00:00.000Z'),
        to_date: new Date('2099-08-13T00:00:00.000Z'),
        reason: 'Inter-college hackathon',
        faculty_guide_id: null,
        mentor_approval_status: 'pending',
      });
      tx.od_request_hod_approvals.createMany.mockResolvedValue({ count: 1 });

      const result = await service.submitOdRequest(103, 61, validDto);

      expect(prisma.faculty.findUnique).not.toHaveBeenCalled();
      const [createArgs] = tx.od_requests.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(createArgs.data).toMatchObject({ faculty_guide_id: null });
      expect(result).toMatchObject({
        faculty_guide_id: null,
        faculty_guide_name: null,
      });
    });

    it('parses from_time/to_time (HH:mm) into fixed-epoch-date Dates and formats them back as HH:mm', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
      });
      prisma.od_team_members.findMany.mockResolvedValue([{ student_id: 7 }]);
      prisma.students.findMany.mockResolvedValue([
        { id: 7, classes: { department_id: 1, departments: { name: 'CSE' } } },
      ]);
      tx.od_requests.create.mockResolvedValue({
        id: 61,
        team_id: 61,
        from_date: new Date('2099-08-12T00:00:00.000Z'),
        to_date: new Date('2099-08-13T00:00:00.000Z'),
        from_time: new Date('1970-01-01T09:30:00.000Z'),
        to_time: new Date('1970-01-01T17:00:00.000Z'),
        reason: null,
        mentor_approval_status: 'pending',
      });
      tx.od_request_hod_approvals.createMany.mockResolvedValue({ count: 1 });

      const result = await service.submitOdRequest(103, 61, {
        from_date: '2099-08-12',
        to_date: '2099-08-13',
        from_time: '09:30',
        to_time: '17:00',
      });

      const [createArgs] = tx.od_requests.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(createArgs.data).toMatchObject({
        from_time: new Date('1970-01-01T09:30:00.000Z'),
        to_time: new Date('1970-01-01T17:00:00.000Z'),
      });
      expect(result).toMatchObject({ from_time: '09:30', to_time: '17:00' });
    });

    it('leaves from_time/to_time null when omitted from the request', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
      });
      prisma.od_team_members.findMany.mockResolvedValue([{ student_id: 7 }]);
      prisma.students.findMany.mockResolvedValue([
        { id: 7, classes: { department_id: 1, departments: { name: 'CSE' } } },
      ]);
      tx.od_requests.create.mockResolvedValue({
        id: 61,
        team_id: 61,
        from_date: new Date('2099-08-12T00:00:00.000Z'),
        to_date: new Date('2099-08-13T00:00:00.000Z'),
        from_time: null,
        to_time: null,
        reason: null,
        mentor_approval_status: 'pending',
      });
      tx.od_request_hod_approvals.createMany.mockResolvedValue({ count: 1 });

      await service.submitOdRequest(103, 61, {
        from_date: '2099-08-12',
        to_date: '2099-08-13',
      });

      const [createArgs] = tx.od_requests.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(createArgs.data).toMatchObject({ from_time: null, to_time: null });
    });

    it('gives two same-department members independent approval rows (schema-resolved dedup rule)', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
      });
      prisma.od_team_members.findMany.mockResolvedValue([
        { student_id: 7 },
        { student_id: 8 },
      ]);
      prisma.students.findMany.mockResolvedValue([
        { id: 7, classes: { department_id: 1, departments: { name: 'CSE' } } },
        { id: 8, classes: { department_id: 1, departments: { name: 'CSE' } } },
      ]);
      tx.od_requests.create.mockResolvedValue({
        id: 61,
        team_id: 61,
        from_date: new Date('2099-08-12T00:00:00.000Z'),
        to_date: new Date('2099-08-13T00:00:00.000Z'),
        reason: null,
        mentor_approval_status: 'pending',
      });
      tx.od_request_hod_approvals.createMany.mockResolvedValue({ count: 2 });

      await service.submitOdRequest(103, 61, {
        from_date: '2099-08-12',
        to_date: '2099-08-13',
      });

      const [createManyArgs] = tx.od_request_hod_approvals.createMany.mock
        .calls[0] as [{ data: Record<string, unknown>[] }];
      expect(createManyArgs.data).toHaveLength(2);
      expect(createManyArgs.data[0].student_id).toBe(7);
      expect(createManyArgs.data[1].student_id).toBe(8);
    });

    it('throws 422 INVALID_DATE_RANGE when from_date is in the past', async () => {
      await expect(
        service.submitOdRequest(103, 61, {
          from_date: '2020-01-01',
          to_date: '2020-01-05',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'INVALID_DATE_RANGE' },
      });
      expect(prisma.students.findUnique).not.toHaveBeenCalled();
    });

    it('throws 422 INVALID_DATE_RANGE when from_date is after to_date', async () => {
      await expect(
        service.submitOdRequest(103, 61, {
          from_date: '2099-08-10',
          to_date: '2099-08-05',
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'INVALID_DATE_RANGE' },
      });
    });

    it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(
        service.submitOdRequest(999, 61, validDto),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'STUDENT_NOT_FOUND' },
      });
    });

    it('throws 404 TEAM_NOT_FOUND when id matches no team', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue(null);

      await expect(
        service.submitOdRequest(103, 999, validDto),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'TEAM_NOT_FOUND' },
      });
    });

    it('throws 403 NOT_TEAM_CREATOR when caller is not the creator', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 8 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
      });

      await expect(
        service.submitOdRequest(555, 61, validDto),
      ).rejects.toMatchObject({
        status: 403,
        response: { errorCode: 'NOT_TEAM_CREATOR' },
      });
      expect(prisma.od_team_members.findMany).not.toHaveBeenCalled();
    });

    it('throws 409 REQUEST_ALREADY_SUBMITTED when the team is already locked', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: true,
      });

      await expect(
        service.submitOdRequest(103, 61, validDto),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'REQUEST_ALREADY_SUBMITTED' },
      });
    });

    it('throws 422 MEMBER_MISSING_DEPARTMENT when a member has no class assigned', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
      });
      prisma.od_team_members.findMany.mockResolvedValue([
        { student_id: 7 },
        { student_id: 8 },
      ]);
      prisma.students.findMany.mockResolvedValue([
        { id: 7, classes: { department_id: 1, departments: { name: 'CSE' } } },
        { id: 8, classes: null },
      ]);

      await expect(
        service.submitOdRequest(103, 61, validDto),
      ).rejects.toMatchObject({
        status: 422,
        response: { errorCode: 'MEMBER_MISSING_DEPARTMENT' },
      });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows a solo team (creator-only member) to submit a request', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
      });
      prisma.od_team_members.findMany.mockResolvedValue([{ student_id: 7 }]);
      prisma.students.findMany.mockResolvedValue([
        { id: 7, classes: { department_id: 1, departments: { name: 'CSE' } } },
      ]);
      tx.od_requests.create.mockResolvedValue({
        id: 61,
        team_id: 61,
        from_date: new Date('2099-08-12T00:00:00.000Z'),
        to_date: new Date('2099-08-13T00:00:00.000Z'),
        reason: 'Solo',
        mentor_approval_status: 'pending',
      });
      tx.od_request_hod_approvals.createMany.mockResolvedValue({ count: 1 });

      const result = await service.submitOdRequest(103, 61, {
        ...validDto,
        reason: 'Solo',
      });

      expect(result.hod_approvals).toHaveLength(1);
    });

    it('wraps a DB failure mid-transaction as 500 INTERNAL_ERROR', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
      });
      prisma.od_team_members.findMany.mockResolvedValue([{ student_id: 7 }]);
      prisma.students.findMany.mockResolvedValue([
        { id: 7, classes: { department_id: 1, departments: { name: 'CSE' } } },
      ]);
      prisma.$transaction.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.submitOdRequest(103, 61, validDto),
      ).rejects.toMatchObject({
        status: 500,
        response: { errorCode: 'INTERNAL_ERROR' },
      });
    });

    it('throws 409 REQUEST_ALREADY_SUBMITTED via the atomic lock check when a race slips past the pre-check', async () => {
      // Simulates the confirmed-live race: the early is_locked read passes
      // (team.is_locked: false), but by the time the transaction's
      // conditional UPDATE runs, a concurrent request has already locked
      // the team — updateMany matches zero rows.
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
      });
      prisma.od_team_members.findMany.mockResolvedValue([{ student_id: 7 }]);
      prisma.students.findMany.mockResolvedValue([
        { id: 7, classes: { department_id: 1, departments: { name: 'CSE' } } },
      ]);
      tx.od_teams.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.submitOdRequest(103, 61, validDto),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'REQUEST_ALREADY_SUBMITTED' },
      });
      expect(tx.od_teams.updateMany).toHaveBeenCalledWith({
        where: { id: 61, is_locked: false },
        data: { is_locked: true },
      });
      expect(tx.od_requests.create).not.toHaveBeenCalled();
    });

    it('allows a team with zero members to submit, producing an empty hod_approvals array', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
      });
      prisma.od_team_members.findMany.mockResolvedValue([]);
      prisma.students.findMany.mockResolvedValue([]);
      tx.od_requests.create.mockResolvedValue({
        id: 61,
        team_id: 61,
        from_date: new Date('2099-08-12T00:00:00.000Z'),
        to_date: new Date('2099-08-13T00:00:00.000Z'),
        reason: null,
        mentor_approval_status: 'pending',
      });
      tx.od_request_hod_approvals.createMany.mockResolvedValue({ count: 0 });

      const result = await service.submitOdRequest(103, 61, {
        from_date: '2099-08-12',
        to_date: '2099-08-13',
      });

      expect(result.hod_approvals).toEqual([]);
    });

    it("notifies the creator's mentor and every distinct department's HoD, right at submission", async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7, class_id: 5 });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
        unique_code: 'X7K9QT',
      });
      prisma.od_team_members.findMany.mockResolvedValue([
        { student_id: 7 },
        { student_id: 8 },
      ]);
      prisma.students.findMany.mockResolvedValue([
        { id: 7, classes: { department_id: 1, departments: { name: 'CSE' } } },
        { id: 8, classes: { department_id: 2, departments: { name: 'Mechanical' } } },
      ]);
      tx.od_requests.create.mockResolvedValue({
        id: 61,
        team_id: 61,
        from_date: new Date('2099-08-12T00:00:00.000Z'),
        to_date: new Date('2099-08-13T00:00:00.000Z'),
        reason: null,
        mentor_approval_status: 'pending',
      });
      tx.od_request_hod_approvals.createMany.mockResolvedValue({ count: 2 });
      prisma.class_mentors.findFirst.mockResolvedValue({ faculty_id: 30 });
      prisma.faculty.findUnique.mockResolvedValue({ user_id: 300 });
      prisma.departments.findUnique
        .mockResolvedValueOnce({ head_of_department_faculty_id: 40 })
        .mockResolvedValueOnce({ head_of_department_faculty_id: 41 });

      await service.submitOdRequest(103, 61, {
        from_date: '2099-08-12',
        to_date: '2099-08-13',
      });

      expect(prisma.class_mentors.findFirst).toHaveBeenCalledWith({
        where: { class_id: 5 },
        select: { faculty_id: true },
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 300,
          type: 'approval_request_pending',
          related_entity_type: 'od_request',
          related_entity_id: 61,
        }),
      );
      // Once per distinct department (1 and 2), plus once for the mentor = 3 total.
      expect(notifications.notify).toHaveBeenCalledTimes(3);
    });

    it('skips the mentor notification (without erroring) when the creator has no class assigned', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 7, class_id: null });
      prisma.od_teams.findUnique.mockResolvedValue({
        id: 61,
        created_by_student_id: 7,
        is_locked: false,
        unique_code: 'X7K9QT',
      });
      prisma.od_team_members.findMany.mockResolvedValue([{ student_id: 7 }]);
      prisma.students.findMany.mockResolvedValue([
        { id: 7, classes: { department_id: 1, departments: { name: 'CSE' } } },
      ]);
      tx.od_requests.create.mockResolvedValue({
        id: 61,
        team_id: 61,
        from_date: new Date('2099-08-12T00:00:00.000Z'),
        to_date: new Date('2099-08-13T00:00:00.000Z'),
        reason: null,
        mentor_approval_status: 'pending',
      });
      tx.od_request_hod_approvals.createMany.mockResolvedValue({ count: 1 });
      prisma.departments.findUnique.mockResolvedValue({ head_of_department_faculty_id: null });

      await service.submitOdRequest(103, 61, {
        from_date: '2099-08-12',
        to_date: '2099-08-13',
      });

      expect(prisma.class_mentors.findFirst).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });
});
