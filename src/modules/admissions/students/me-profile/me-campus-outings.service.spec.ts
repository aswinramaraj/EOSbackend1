import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeCampusOutingsService } from './me-campus-outings.service';

describe('MeCampusOutingsService', () => {
  let service: MeCampusOutingsService;
  let prisma: {
    students: { findUnique: jest.Mock };
    campus_outing_requests: {
      create: jest.Mock;
      count: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      campus_outing_requests: {
        create: jest.fn(),
        count: jest.fn(),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeCampusOutingsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeCampusOutingsService>(MeCampusOutingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a pending outing request scoped to the resolved student_id - no hosteller check, unlike hostel-outings', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 8 });
    prisma.campus_outing_requests.create.mockResolvedValue({
      id: 88,
      from_date: new Date('2099-08-02T00:00:00.000Z'),
      to_date: new Date('2099-08-02T00:00:00.000Z'),
      start_time: new Date('1970-01-01T09:00:00.000Z'),
      return_time: new Date('1970-01-01T18:00:00.000Z'),
      reason: 'Bank work',
      status: 'pending',
      approved_by_faculty_id: null,
      approved_by_hod_user_id: null,
    });

    const result = await service.createCampusOuting(103, {
      from_date: '2099-08-02',
      to_date: '2099-08-02',
      start_time: '09:00',
      return_time: '18:00',
      reason: 'Bank work',
    });

    expect(prisma.students.findUnique).toHaveBeenCalledWith({
      where: { user_id: 103 },
      select: { id: true },
    });
    const [createArgs] = prisma.campus_outing_requests.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(createArgs.data).toMatchObject({
      student_id: 8,
      reason: 'Bank work',
      status: 'pending',
    });
    expect(result).toEqual({
      id: 88,
      from_date: '2099-08-02',
      to_date: '2099-08-02',
      start_time: '09:00',
      return_time: '18:00',
      reason: 'Bank work',
      status: 'pending',
      approved_by_faculty_id: null,
      approved_by_hod_user_id: null,
    });
  });

  it('allows return_time to be omitted, returning null (not a fixed sentinel)', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 8 });
    prisma.campus_outing_requests.create.mockResolvedValue({
      id: 89,
      from_date: new Date('2099-08-02T00:00:00.000Z'),
      to_date: new Date('2099-08-03T00:00:00.000Z'),
      start_time: new Date('1970-01-01T09:00:00.000Z'),
      return_time: null,
      reason: null,
      status: 'pending',
      approved_by_faculty_id: null,
      approved_by_hod_user_id: null,
    });

    const result = await service.createCampusOuting(103, {
      from_date: '2099-08-02',
      to_date: '2099-08-03',
      start_time: '09:00',
    });

    const [createArgs] = prisma.campus_outing_requests.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(createArgs.data.return_time).toBeNull();
    expect(result.return_time).toBeNull();
  });

  it('throws 422 INVALID_DATE_RANGE when from_date is in the past', async () => {
    await expect(
      service.createCampusOuting(103, {
        from_date: '2020-01-01',
        to_date: '2020-01-05',
        start_time: '09:00',
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { errorCode: 'INVALID_DATE_RANGE' },
    });
    expect(prisma.students.findUnique).not.toHaveBeenCalled();
  });

  it('throws 422 INVALID_DATE_RANGE for a same-day outing where return_time is before start_time', async () => {
    await expect(
      service.createCampusOuting(103, {
        from_date: '2099-08-05',
        to_date: '2099-08-05',
        start_time: '18:00',
        return_time: '09:00',
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { errorCode: 'INVALID_DATE_RANGE' },
    });
    expect(prisma.students.findUnique).not.toHaveBeenCalled();
  });

  it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);

    await expect(
      service.createCampusOuting(999, {
        from_date: '2099-08-02',
        to_date: '2099-08-02',
        start_time: '09:00',
      }),
    ).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
    expect(prisma.campus_outing_requests.create).not.toHaveBeenCalled();
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 8 });
    prisma.campus_outing_requests.create.mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(
      service.createCampusOuting(103, {
        from_date: '2099-08-02',
        to_date: '2099-08-02',
        start_time: '09:00',
      }),
    ).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });

  describe('getMyCampusOutings', () => {
    it('resolves approved_by_faculty/approved_by_hod, and handles nulls', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 8 });
      prisma.campus_outing_requests.count.mockResolvedValue(2);
      prisma.campus_outing_requests.findMany.mockResolvedValue([
        {
          id: 2,
          from_date: new Date('2099-08-02T00:00:00.000Z'),
          to_date: new Date('2099-08-02T00:00:00.000Z'),
          start_time: new Date('1970-01-01T08:30:00.000Z'),
          return_time: null,
          reason: null,
          status: 'pending',
          created_at: new Date('2026-07-29T12:44:01.280Z'),
          faculty: null,
          users: null,
        },
        {
          id: 1,
          from_date: new Date('2099-08-02T00:00:00.000Z'),
          to_date: new Date('2099-08-02T00:00:00.000Z'),
          start_time: new Date('1970-01-01T09:00:00.000Z'),
          return_time: new Date('1970-01-01T18:00:00.000Z'),
          reason: 'Bank work',
          status: 'hod_approved',
          created_at: new Date('2026-07-29T12:44:00.788Z'),
          faculty: { first_name: 'Priya', last_name: 'J' },
          users: { email: 'hod@eos.test' },
        },
      ]);

      const result = await service.getMyCampusOutings(103, {});

      expect(prisma.students.findUnique).toHaveBeenCalledWith({
        where: { user_id: 103 },
        select: { id: true },
      });
      expect(result.total).toBe(2);
      expect(result.data[0]).toMatchObject({
        id: 2,
        status: 'pending',
        approved_by_faculty: null,
        approved_by_hod: null,
      });
      expect(result.data[1]).toMatchObject({
        id: 1,
        status: 'hod_approved',
        approved_by_faculty: 'Priya J',
        approved_by_hod: 'hod@eos.test',
      });
    });

    it('filters by status when provided', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 8 });
      prisma.campus_outing_requests.count.mockResolvedValue(0);
      prisma.campus_outing_requests.findMany.mockResolvedValue([]);

      await service.getMyCampusOutings(103, { status: 'rejected' });

      const [countArgs] = prisma.campus_outing_requests.count.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(countArgs.where).toMatchObject({
        student_id: 8,
        status: 'rejected',
      });
    });

    it('applies pagination (page/page_size -> skip/take)', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 8 });
      prisma.campus_outing_requests.count.mockResolvedValue(50);
      prisma.campus_outing_requests.findMany.mockResolvedValue([]);

      await service.getMyCampusOutings(103, { page: 3, page_size: 10 });

      const [findManyArgs] = prisma.campus_outing_requests.findMany.mock
        .calls[0] as [{ skip: number; take: number }];
      expect(findManyArgs.skip).toBe(20);
      expect(findManyArgs.take).toBe(10);
    });

    it('returns an empty list (not an error) when the student has no outing requests', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 8 });
      prisma.campus_outing_requests.count.mockResolvedValue(0);
      prisma.campus_outing_requests.findMany.mockResolvedValue([]);

      const result = await service.getMyCampusOutings(103, {});

      expect(result).toEqual({ data: [], page: 1, page_size: 20, total: 0 });
    });

    it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(service.getMyCampusOutings(999, {})).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'STUDENT_NOT_FOUND' },
      });
    });

    it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 8 });
      prisma.campus_outing_requests.count.mockRejectedValue(
        new Error('connection lost'),
      );

      await expect(service.getMyCampusOutings(103, {})).rejects.toMatchObject({
        status: 500,
        response: { errorCode: 'INTERNAL_ERROR' },
      });
    });
  });
});
