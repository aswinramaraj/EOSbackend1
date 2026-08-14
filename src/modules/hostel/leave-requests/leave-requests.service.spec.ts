jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { LeaveRequestsService } from './leave-requests.service';

describe('LeaveRequestsService', () => {
  let service: LeaveRequestsService;
  let prisma: {
    student_leaves: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  function leaveRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      from_date: new Date('2026-08-20T00:00:00.000Z'),
      to_date: new Date('2026-08-22T00:00:00.000Z'),
      reason: 'Family function',
      status: 'pending',
      routed_to_warden: true,
      created_at: new Date('2026-08-13T00:00:00.000Z'),
      students: {
        id: 42,
        student_id_no: '23IT017',
        roll_no: '23IT017',
        soa_applications: { first_name: 'Vignesh', last_name: 'K' },
        student_hostel_mapping: {
          hostel_rooms: {
            room_number: 'C-214',
            hostels: { id: 1, name: 'Ladies Hostel Block C', code: 'LHC' },
          },
        },
      },
      users_student_leaves_approved_by_warden_user_idTousers: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      student_leaves: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((queries: Promise<unknown>[]) =>
        Promise.all(queries),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaveRequestsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<LeaveRequestsService>(LeaveRequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('scopes the query to routed_to_warden: true, and resolves student name/room/hostel', async () => {
      prisma.student_leaves.findMany.mockResolvedValue([leaveRow()]);
      prisma.student_leaves.count.mockResolvedValue(1);

      const result = await service.findAll({ page: 1, page_size: 20 });

      const [findManyArgs] = prisma.student_leaves.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(findManyArgs.where).toEqual({ routed_to_warden: true });
      expect(result.data[0]).toMatchObject({
        id: 1,
        student: { id: 42, name: 'Vignesh K', student_id_no: '23IT017' },
        hostel: { id: 1, name: 'Ladies Hostel Block C', code: 'LHC' },
        room_number: 'C-214',
        status: 'pending',
      });
    });

    it('additionally filters by status when provided, alongside routed_to_warden: true', async () => {
      prisma.student_leaves.findMany.mockResolvedValue([]);
      prisma.student_leaves.count.mockResolvedValue(0);

      await service.findAll({
        status: 'rejected',
        page: 1,
        page_size: 20,
      });

      const [findManyArgs] = prisma.student_leaves.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(findManyArgs.where).toEqual({
        routed_to_warden: true,
        status: 'rejected',
      });
    });
  });

  describe('decide', () => {
    it('throws 404 LEAVE_REQUEST_NOT_FOUND when no row exists with this id', async () => {
      prisma.student_leaves.findUnique.mockResolvedValue(null);

      await expect(
        service.decide(1, { decision: 'approved' }, 99),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'LEAVE_REQUEST_NOT_FOUND' },
      });
    });

    it('throws 404 LEAVE_REQUEST_NOT_FOUND when the id belongs to an academic-chain leave (routed_to_warden: false)', async () => {
      prisma.student_leaves.findUnique.mockResolvedValue({
        status: 'pending',
        routed_to_warden: false,
      });

      await expect(
        service.decide(1, { decision: 'approved' }, 99),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'LEAVE_REQUEST_NOT_FOUND' },
      });
      expect(prisma.student_leaves.update).not.toHaveBeenCalled();
    });

    it('throws 409 LEAVE_REQUEST_ALREADY_DECIDED when not currently pending', async () => {
      prisma.student_leaves.findUnique.mockResolvedValue({
        status: 'warden_approved',
        routed_to_warden: true,
      });

      await expect(
        service.decide(1, { decision: 'approved' }, 99),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'LEAVE_REQUEST_ALREADY_DECIDED' },
      });
    });

    it('sets status to warden_approved and records approved_by_warden_user_id on approve', async () => {
      prisma.student_leaves.findUnique.mockResolvedValue({
        status: 'pending',
        routed_to_warden: true,
      });
      prisma.student_leaves.update.mockResolvedValue(
        leaveRow({ status: 'warden_approved' }),
      );

      await service.decide(1, { decision: 'approved' }, 99);

      expect(prisma.student_leaves.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'warden_approved', approved_by_warden_user_id: 99 },
        include: expect.any(Object),
      });
    });

    it('sets status to rejected on reject', async () => {
      prisma.student_leaves.findUnique.mockResolvedValue({
        status: 'pending',
        routed_to_warden: true,
      });
      prisma.student_leaves.update.mockResolvedValue(
        leaveRow({ status: 'rejected' }),
      );

      await service.decide(1, { decision: 'rejected' }, 99);

      expect(prisma.student_leaves.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'rejected', approved_by_warden_user_id: 99 },
        include: expect.any(Object),
      });
    });
  });

  describe('findFromAcademicLeave', () => {
    it('scopes the query to also_on_hostel_leave: true AND routed_to_warden: false', async () => {
      prisma.student_leaves.findMany.mockResolvedValue([]);
      prisma.student_leaves.count.mockResolvedValue(0);

      await service.findFromAcademicLeave({ page: 1, page_size: 20 });

      const [findManyArgs] = prisma.student_leaves.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(findManyArgs.where).toEqual({
        also_on_hostel_leave: true,
        routed_to_warden: false,
      });
    });

    it('maps rows to student + academic status, informational only', async () => {
      prisma.student_leaves.findMany.mockResolvedValue([
        {
          id: 5,
          from_date: new Date('2026-08-12T00:00:00.000Z'),
          to_date: new Date('2026-08-12T00:00:00.000Z'),
          reason: 'Family function',
          status: 'hod_approved',
          created_at: new Date('2026-08-10T00:00:00.000Z'),
          students: {
            id: 7,
            student_id_no: '23IT018',
            roll_no: '23IT018',
            soa_applications: null,
          },
        },
      ]);
      prisma.student_leaves.count.mockResolvedValue(1);

      const result = await service.findFromAcademicLeave({
        page: 1,
        page_size: 20,
      });

      expect(result.data[0]).toMatchObject({
        id: 5,
        student: { id: 7, name: 'Student 23IT018', student_id_no: '23IT018' },
        status: 'hod_approved',
      });
    });
  });
});
