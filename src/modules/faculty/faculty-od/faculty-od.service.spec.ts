jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/modules/storage/storage.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { FacultyOdService } from './faculty-od.service';

const FACULTY_ROW = {
  id: 5,
  first_name: 'Deepa',
  last_name: 'Kannan',
  designation: 'Professor',
  user_id: 42,
  department_id: 3,
  departments: { id: 3, name: 'Computer Science' },
};

describe('FacultyOdService', () => {
  let service: FacultyOdService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    faculty_od_requests: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      faculty_od_requests: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacultyOdService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: { upload: jest.fn(), remove: jest.fn() } },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = module.get<FacultyOdService>(FacultyOdService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('throws 404 when the JWT user has no linked faculty record', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          { from_date: '2026-09-01', to_date: '2026-09-02' },
          { sub: 999, role: 'faculty' } as any,
        ),
      ).rejects.toThrow('Faculty profile not found for the authenticated user');
    });

    it('rejects a from_date before today', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });

      await expect(
        service.create(
          { from_date: '2020-01-01', to_date: '2020-01-02' },
          { sub: 1, role: 'faculty' } as any,
        ),
      ).rejects.toThrow("from_date must not be before today's date");
    });

    it('rejects from_date after to_date', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      const future = new Date();
      future.setDate(future.getDate() + 10);
      const futureStr = future.toISOString().slice(0, 10);

      await expect(
        service.create(
          { from_date: futureStr, to_date: '2026-01-01' },
          { sub: 1, role: 'faculty' } as any,
        ),
      ).rejects.toThrow('from_date must be on or before to_date');
    });

    it('creates an OD request scoped to the caller and returns overall_status', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.faculty_od_requests.create.mockResolvedValue({
        id: 1,
        from_date: new Date('2026-09-01T00:00:00.000Z'),
        to_date: new Date('2026-09-02T00:00:00.000Z'),
        place: 'IIT Madras',
        purpose: 'FDP on Generative AI',
        hod_approval_status: 'pending',
        hr_approval_status: 'pending',
        created_at: new Date('2026-08-06T00:00:00.000Z'),
        faculty: FACULTY_ROW,
      });

      const future = new Date();
      future.setDate(future.getDate() + 30);
      const from = future.toISOString().slice(0, 10);

      const result = await service.create(
        { from_date: from, to_date: from, place: 'IIT Madras', purpose: 'FDP on Generative AI' },
        { sub: 1, role: 'faculty' } as any,
      );

      expect(prisma.faculty_od_requests.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ faculty_id: 5 }),
        }),
      );
      expect(result.overall_status).toBe('pending');
      expect(result.place).toBe('IIT Madras');
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

    it('scopes an HoD caller to their own department', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 3, department_id: 9 });
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        { limit: 20, page: 1 } as any,
        { sub: 2, role: 'hod', email: 'x', roleId: 1 },
      );

      expect(prisma.faculty.findUnique).toHaveBeenCalledWith({
        where: { user_id: 2 },
      });
    });

    it('force-filters an HR Payroll caller to hod_approval_status=approved, overriding whatever the query param says', async () => {
      prisma.$transaction.mockResolvedValue([[], 0]);

      await service.findAll(
        { hod_approval_status: 'pending', limit: 20, page: 1 } as any,
        { sub: 3, role: 'hr_payroll', email: 'x', roleId: 1 },
      );

      expect(prisma.faculty_od_requests.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ hod_approval_status: 'approved' }),
        }),
      );
    });
  });

  describe('update', () => {
    const HOD_USER = { sub: 10, role: 'hod', email: 'hod@x', roleId: 2 };
    const HR_USER = { sub: 20, role: 'hr_payroll', email: 'hr@x', roleId: 3 };

    it('throws 400 when no fields are provided', async () => {
      await expect(service.update(1, {}, HR_USER)).rejects.toThrow(
        'No fields provided to update',
      );
    });

    it('throws 404 when the OD request does not exist', async () => {
      prisma.faculty_od_requests.findUnique.mockResolvedValue(null);

      await expect(
        service.update(1, { hr_approval_status: 'approved' }, HR_USER),
      ).rejects.toThrow('Faculty OD request not found');
    });

    it('lets HoD set hod_approval_status', async () => {
      prisma.faculty_od_requests.findUnique.mockResolvedValue({
        id: 1,
        hod_approval_status: 'pending',
        hr_approval_status: 'pending',
      });
      prisma.faculty_od_requests.update.mockResolvedValue({
        id: 1,
        from_date: new Date('2026-09-01T00:00:00.000Z'),
        to_date: new Date('2026-09-02T00:00:00.000Z'),
        place: 'IIT Madras',
        purpose: 'FDP',
        hod_approval_status: 'approved',
        hr_approval_status: 'pending',
        created_at: new Date('2026-08-06T00:00:00.000Z'),
        faculty: FACULTY_ROW,
      });

      const result = await service.update(
        1,
        { hod_approval_status: 'approved' },
        HOD_USER,
      );

      expect(prisma.faculty_od_requests.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { hod_approval_status: 'approved' } }),
      );
      expect(result.overall_status).toBe('pending');
    });

    it('forbids HoD from setting hr_approval_status', async () => {
      prisma.faculty_od_requests.findUnique.mockResolvedValue({
        id: 1,
        hod_approval_status: 'pending',
        hr_approval_status: 'pending',
      });

      await expect(
        service.update(1, { hr_approval_status: 'approved' }, HOD_USER),
      ).rejects.toThrow('HoD may only set hod_approval_status');
    });

    it('forbids HR Payroll from setting hod_approval_status', async () => {
      prisma.faculty_od_requests.findUnique.mockResolvedValue({
        id: 1,
        hod_approval_status: 'pending',
        hr_approval_status: 'pending',
      });

      await expect(
        service.update(1, { hod_approval_status: 'approved' }, HR_USER),
      ).rejects.toThrow('HR Payroll may only set hr_approval_status');
    });

    it('throws 409 when HR Payroll tries to act before HoD has approved', async () => {
      prisma.faculty_od_requests.findUnique.mockResolvedValue({
        id: 1,
        hod_approval_status: 'pending',
        hr_approval_status: 'pending',
      });

      await expect(
        service.update(1, { hr_approval_status: 'approved' }, HR_USER),
      ).rejects.toThrow('HR approval requires HoD approval first');
    });

    it('lets HR Payroll set hr_approval_status once HoD has approved, computing overall_status', async () => {
      prisma.faculty_od_requests.findUnique.mockResolvedValue({
        id: 1,
        hod_approval_status: 'approved',
        hr_approval_status: 'pending',
      });
      prisma.faculty_od_requests.update.mockResolvedValue({
        id: 1,
        from_date: new Date('2026-09-01T00:00:00.000Z'),
        to_date: new Date('2026-09-02T00:00:00.000Z'),
        place: 'IIT Madras',
        purpose: 'FDP',
        hod_approval_status: 'approved',
        hr_approval_status: 'approved',
        created_at: new Date('2026-08-06T00:00:00.000Z'),
        faculty: FACULTY_ROW,
      });

      const result = await service.update(
        1,
        { hr_approval_status: 'approved' },
        HR_USER,
      );

      expect(prisma.faculty_od_requests.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { hr_approval_status: 'approved' } }),
      );
      expect(result.overall_status).toBe('approved');
    });
  });
});
