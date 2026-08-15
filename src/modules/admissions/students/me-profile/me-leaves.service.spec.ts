import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeLeavesService } from './me-leaves.service';

describe('MeLeavesService', () => {
  let service: MeLeavesService;
  let prisma: {
    students: { findUnique: jest.Mock };
    student_hostel_mapping: { findUnique: jest.Mock };
    student_leaves: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      student_hostel_mapping: { findUnique: jest.fn() },
      student_leaves: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeLeavesService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeLeavesService>(MeLeavesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates a pending leave request scoped to the resolved student_id', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 3310 });
    prisma.student_leaves.create.mockResolvedValue({
      id: 214,
      student_id: 3310,
      from_date: new Date('2099-08-01T00:00:00.000Z'),
      to_date: new Date('2099-08-03T00:00:00.000Z'),
      reason: 'Family function',
      status: 'pending',
      approved_by_faculty_id: null,
      approved_by_hod_user_id: null,
      approved_by_warden_user_id: null,
      also_on_hostel_leave: false,
      routed_to_warden: false,
    });

    const result = await service.createLeave(7, {
      from_date: '2099-08-01',
      to_date: '2099-08-03',
      reason: 'Family function',
    });

    expect(prisma.students.findUnique).toHaveBeenCalledWith({
      where: { user_id: 7 },
      select: { id: true },
    });
    expect(prisma.student_hostel_mapping.findUnique).not.toHaveBeenCalled();
    const [createArgs] = prisma.student_leaves.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(createArgs.data).toMatchObject({
      student_id: 3310,
      reason: 'Family function',
      status: 'pending',
      also_on_hostel_leave: false,
      routed_to_warden: false,
    });
    expect(result).toEqual({
      id: 214,
      student_id: 3310,
      from_date: '2099-08-01',
      to_date: '2099-08-03',
      reason: 'Family function',
      status: 'pending',
      approved_by_faculty_id: null,
      approved_by_hod_user_id: null,
      approved_by_warden_user_id: null,
      also_on_hostel_leave: false,
      routed_to_warden: false,
    });
  });

  it('routed_to_warden=true requires a student_hostel_mapping row (422 NOT_A_HOSTELLER otherwise)', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 3310 });
    prisma.student_hostel_mapping.findUnique.mockResolvedValue(null);

    await expect(
      service.createLeave(7, {
        from_date: '2099-08-01',
        to_date: '2099-08-03',
        routed_to_warden: true,
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { errorCode: 'NOT_A_HOSTELLER' },
    });
    expect(prisma.student_leaves.create).not.toHaveBeenCalled();
  });

  it('routed_to_warden=true persists on the row when the caller is a hosteller', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 3310 });
    prisma.student_hostel_mapping.findUnique.mockResolvedValue({
      student_id: 3310,
    });
    prisma.student_leaves.create.mockResolvedValue({
      id: 215,
      student_id: 3310,
      from_date: new Date('2099-08-01T00:00:00.000Z'),
      to_date: new Date('2099-08-03T00:00:00.000Z'),
      reason: null,
      status: 'pending',
      approved_by_faculty_id: null,
      approved_by_hod_user_id: null,
      approved_by_warden_user_id: null,
      also_on_hostel_leave: false,
      routed_to_warden: true,
    });

    const result = await service.createLeave(7, {
      from_date: '2099-08-01',
      to_date: '2099-08-03',
      routed_to_warden: true,
    });

    expect(prisma.student_hostel_mapping.findUnique).toHaveBeenCalledWith({
      where: { student_id: 3310 },
    });
    const [createArgs] = prisma.student_leaves.create.mock.calls[0] as [
      { data: Record<string, unknown> },
    ];
    expect(createArgs.data).toMatchObject({ routed_to_warden: true });
    expect(result.routed_to_warden).toBe(true);
  });

  it('throws 422 INVALID_DATE_RANGE when from_date is in the past', async () => {
    await expect(
      service.createLeave(7, {
        from_date: '2020-01-01',
        to_date: '2020-01-05',
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        errorCode: 'INVALID_DATE_RANGE',
        message:
          'from_date must not be in the past and must be on or before to_date',
      },
    });
    expect(prisma.students.findUnique).not.toHaveBeenCalled();
  });

  it('throws 422 INVALID_DATE_RANGE when from_date is after to_date', async () => {
    await expect(
      service.createLeave(7, {
        from_date: '2099-08-10',
        to_date: '2099-08-05',
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: { errorCode: 'INVALID_DATE_RANGE' },
    });
  });

  it('allows from_date equal to today (boundary, not "in the past")', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 3310 });
    prisma.student_leaves.create.mockResolvedValue({
      id: 1,
      student_id: 3310,
      from_date: new Date(),
      to_date: new Date(),
      reason: null,
      status: 'pending',
      approved_by_faculty_id: null,
      approved_by_hod_user_id: null,
    });
    const today = new Date().toISOString().slice(0, 10);

    await expect(
      service.createLeave(7, { from_date: today, to_date: today }),
    ).resolves.toBeDefined();
  });

  it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);

    await expect(
      service.createLeave(999, {
        from_date: '2099-08-01',
        to_date: '2099-08-03',
      }),
    ).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
    expect(prisma.student_leaves.create).not.toHaveBeenCalled();
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 3310 });
    prisma.student_leaves.create.mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(
      service.createLeave(7, {
        from_date: '2099-08-01',
        to_date: '2099-08-03',
      }),
    ).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });
});
