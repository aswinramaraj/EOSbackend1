import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeLeavesListService } from './me-leaves-list.service';

describe('MeLeavesListService', () => {
  let service: MeLeavesListService;
  let prisma: {
    students: { findUnique: jest.Mock };
    student_leaves: { count: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      student_leaves: { count: jest.fn(), findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeLeavesListService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeLeavesListService>(MeLeavesListService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);

    await expect(service.getMyLeaves(999, {})).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
  });

  it('resolves approved_by_faculty and approved_by_hod display strings, and handles nulls', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 7 });
    prisma.student_leaves.count.mockResolvedValue(2);
    prisma.student_leaves.findMany.mockResolvedValue([
      {
        id: 214,
        from_date: new Date('2026-08-01T00:00:00.000Z'),
        to_date: new Date('2026-08-03T00:00:00.000Z'),
        reason: 'Family function',
        status: 'pending',
        created_at: new Date('2026-07-26T10:00:00.000Z'),
        faculty: null,
        users: null,
      },
      {
        id: 190,
        from_date: new Date('2026-06-10T00:00:00.000Z'),
        to_date: new Date('2026-06-11T00:00:00.000Z'),
        reason: 'Medical',
        status: 'hod_approved',
        created_at: new Date('2026-06-08T14:00:00.000Z'),
        faculty: { first_name: 'Priya', last_name: 'J' },
        users: { email: 'hod@eos.test' },
      },
    ]);

    const result = await service.getMyLeaves(1, {});

    expect(prisma.students.findUnique).toHaveBeenCalledWith({
      where: { user_id: 1 },
      select: { id: true },
    });
    expect(result.total).toBe(2);
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(20);
    expect(result.data[0]).toMatchObject({
      id: 214,
      from_date: '2026-08-01',
      to_date: '2026-08-03',
      status: 'pending',
      approved_by_faculty: null,
      approved_by_hod: null,
    });
    expect(result.data[1]).toMatchObject({
      id: 190,
      status: 'hod_approved',
      approved_by_faculty: 'Priya J',
      approved_by_hod: 'hod@eos.test',
    });
  });

  it('filters by status when provided', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 7 });
    prisma.student_leaves.count.mockResolvedValue(0);
    prisma.student_leaves.findMany.mockResolvedValue([]);

    await service.getMyLeaves(1, { status: 'rejected' });

    const [countArgs] = prisma.student_leaves.count.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(countArgs.where).toMatchObject({
      student_id: 7,
      status: 'rejected',
    });
  });

  it('filters by routed_to_warden when provided, and omits it from the where clause otherwise', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 7 });
    prisma.student_leaves.count.mockResolvedValue(0);
    prisma.student_leaves.findMany.mockResolvedValue([]);

    await service.getMyLeaves(1, { routed_to_warden: true });

    const [countArgs] = prisma.student_leaves.count.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(countArgs.where).toEqual({ student_id: 7, routed_to_warden: true });
  });

  it('resolves approved_by_warden from the second users relation, and surfaces also_on_hostel_leave/routed_to_warden', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 7 });
    prisma.student_leaves.count.mockResolvedValue(1);
    prisma.student_leaves.findMany.mockResolvedValue([
      {
        id: 301,
        from_date: new Date('2026-08-20T00:00:00.000Z'),
        to_date: new Date('2026-08-22T00:00:00.000Z'),
        reason: 'Going home',
        status: 'warden_approved',
        created_at: new Date('2026-08-13T00:00:00.000Z'),
        also_on_hostel_leave: false,
        routed_to_warden: true,
        faculty: null,
        users: null,
        users_student_leaves_approved_by_warden_user_idTousers: {
          email: 'warden@eos.test',
        },
      },
    ]);

    const result = await service.getMyLeaves(1, {});

    expect(result.data[0]).toMatchObject({
      id: 301,
      status: 'warden_approved',
      also_on_hostel_leave: false,
      routed_to_warden: true,
      approved_by_faculty: null,
      approved_by_hod: null,
      approved_by_warden: 'warden@eos.test',
    });
  });

  it('applies pagination (page/page_size → skip/take)', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 7 });
    prisma.student_leaves.count.mockResolvedValue(50);
    prisma.student_leaves.findMany.mockResolvedValue([]);

    await service.getMyLeaves(1, { page: 3, page_size: 10 });

    const [findManyArgs] = prisma.student_leaves.findMany.mock.calls[0] as [
      { skip: number; take: number },
    ];
    expect(findManyArgs.skip).toBe(20);
    expect(findManyArgs.take).toBe(10);
  });

  it('returns an empty list (not an error) when the student has no leave requests', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 7 });
    prisma.student_leaves.count.mockResolvedValue(0);
    prisma.student_leaves.findMany.mockResolvedValue([]);

    const result = await service.getMyLeaves(1, {});

    expect(result).toEqual({ data: [], page: 1, page_size: 20, total: 0 });
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 7 });
    prisma.student_leaves.count.mockRejectedValue(new Error('connection lost'));

    await expect(service.getMyLeaves(1, {})).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });
});
