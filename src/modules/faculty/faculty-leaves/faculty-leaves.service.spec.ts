jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { FacultyLeavesService } from './faculty-leaves.service';

describe('FacultyLeavesService', () => {
  let service: FacultyLeavesService;
  let notifications: { notify: jest.Mock };
  let prisma: {
    faculty: { findUnique: jest.Mock };
    faculty_leaves: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    departments: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      faculty_leaves: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      departments: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };
    notifications = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacultyLeavesService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<FacultyLeavesService>(FacultyLeavesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const faculty = {
      id: 5,
      department_id: 10,
      first_name: 'Ada',
      last_name: 'Lovelace',
    };
    const dto = { from_date: '2026-09-01', to_date: '2026-09-03', reason: 'Conference' } as any;

    it('notifies the department HoD when a non-HoD faculty member requests leave', async () => {
      prisma.faculty.findUnique.mockResolvedValue(faculty);
      prisma.faculty_leaves.create.mockResolvedValue({
        id: 42,
        faculty,
        hod_approval_status: 'pending',
        hr_approval_status: 'pending',
      });
      prisma.departments.findUnique.mockResolvedValue({ head_of_department_faculty_id: 99 });
      prisma.faculty.findUnique.mockResolvedValueOnce(faculty).mockResolvedValueOnce({ user_id: 777 });

      await service.create(dto, { sub: 1, role: 'faculty', email: 'x', roleId: 1 });

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 777,
          type: 'approval_request_pending',
          related_entity_type: 'faculty_leave',
          related_entity_id: 42,
        }),
      );
    });

    it('does not notify anyone when the department has no HoD on record', async () => {
      prisma.faculty.findUnique.mockResolvedValueOnce(faculty);
      prisma.faculty_leaves.create.mockResolvedValue({
        id: 42,
        faculty,
        hod_approval_status: 'pending',
        hr_approval_status: 'pending',
      });
      prisma.departments.findUnique.mockResolvedValue({ head_of_department_faculty_id: null });

      await service.create(dto, { sub: 1, role: 'faculty', email: 'x', roleId: 1 });

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('does not notify anyone when an HoD requests their own leave (auto-approved, skips the HoD stage)', async () => {
      prisma.faculty.findUnique.mockResolvedValue(faculty);
      prisma.faculty_leaves.create.mockResolvedValue({
        id: 43,
        faculty,
        hod_approval_status: 'approved',
        hr_approval_status: 'pending',
      });

      await service.create(dto, { sub: 1, role: 'hod', email: 'x', roleId: 1 });

      expect(prisma.departments.findUnique).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    const existing = {
      id: 42,
      faculty_id: 5,
      hod_approval_status: 'pending',
      hr_approval_status: 'pending',
      from_date: new Date('2026-09-01'),
      to_date: new Date('2026-09-03'),
    };

    it('notifies the requesting faculty when an HoD approves the request', async () => {
      prisma.faculty_leaves.findUnique.mockResolvedValue(existing);
      prisma.faculty.findUnique
        .mockResolvedValueOnce({ id: 9, department_id: 10 }) // resolveFacultyByUserId(HoD)
        .mockResolvedValueOnce({ department_id: 10 }) // requestingFaculty lookup
        .mockResolvedValueOnce({ user_id: 555 }); // requester lookup for notify
      prisma.faculty_leaves.update.mockResolvedValue({
        ...existing,
        hod_approval_status: 'approved',
        faculty: { id: 5, first_name: 'Ada', last_name: 'Lovelace', departments: null },
      });

      await service.update(
        42,
        { hod_approval_status: 'approved' } as any,
        { sub: 2, role: 'hod', email: 'x', roleId: 1 },
      );

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 555,
          type: 'approval_request_approved',
          related_entity_type: 'faculty_leave',
          related_entity_id: 42,
        }),
      );
    });

    it('notifies the requesting faculty when HR Payroll rejects the request', async () => {
      prisma.faculty_leaves.findUnique.mockResolvedValue({
        ...existing,
        hod_approval_status: 'approved',
      });
      prisma.faculty.findUnique.mockResolvedValueOnce({ user_id: 555 });
      prisma.faculty_leaves.update.mockResolvedValue({
        ...existing,
        hod_approval_status: 'approved',
        hr_approval_status: 'rejected',
        faculty: { id: 5, first_name: 'Ada', last_name: 'Lovelace', departments: null },
      });

      await service.update(
        42,
        { hr_approval_status: 'rejected' } as any,
        { sub: 3, role: 'hr_payroll', email: 'x', roleId: 1 },
      );

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 555,
          type: 'approval_request_rejected',
          related_entity_type: 'faculty_leave',
          related_entity_id: 42,
        }),
      );
    });
  });

  describe('findAll', () => {
    it('force-scopes a FACULTY caller to their own faculty_id regardless of the query param', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        { faculty_id: 999, limit: 20, page: 1 } as any,
        { sub: 1, role: 'faculty', email: 'x', roleId: 1 },
      );

      expect(prisma.faculty.findUnique).toHaveBeenCalledWith({
        where: { user_id: 1 },
      });
    });

    it('scopes an HoD caller to their own department, overriding whatever the query param says', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 10 });
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        { limit: 20, page: 1 } as any,
        { sub: 2, role: 'hod', email: 'x', roleId: 1 },
      );

      expect(prisma.faculty.findUnique).toHaveBeenCalledWith({
        where: { user_id: 2 },
      });
      expect(prisma.faculty_leaves.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ faculty: { department_id: 10 } }),
        }),
      );
    });

    it('force-filters an HR Payroll caller to hod_approval_status=approved, overriding whatever the query param says', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        { hod_approval_status: 'pending', limit: 20, page: 1 } as any,
        { sub: 3, role: 'hr_payroll', email: 'x', roleId: 1 },
      );

      expect(prisma.faculty_leaves.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ hod_approval_status: 'approved' }),
        }),
      );
    });
  });
});
