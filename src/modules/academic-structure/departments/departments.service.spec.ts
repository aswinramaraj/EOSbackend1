jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditLogService } from 'src/common/audit-log/audit-log.service';
import { DepartmentsService } from './departments.service';

describe('DepartmentsService', () => {
  let service: DepartmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentsService,
        { provide: PrismaService, useValue: {} },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
      ],
    }).compile();

    service = module.get<DepartmentsService>(DepartmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

describe('DepartmentsService.assignHod', () => {
  let service: DepartmentsService;
  let auditLog: { record: jest.Mock };
  let tx: {
    departments: { update: jest.Mock };
    roles: { findUniqueOrThrow: jest.Mock };
    users: { update: jest.Mock };
  };
  let prisma: {
    departments: { findUnique: jest.Mock };
    faculty: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = {
      departments: { update: jest.fn() },
      roles: { findUniqueOrThrow: jest.fn() },
      users: { update: jest.fn() },
    };
    prisma = {
      departments: { findUnique: jest.fn() },
      faculty: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DepartmentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = module.get<DepartmentsService>(DepartmentsService);
    // findOne() does its own independent read, unrelated to what this
    // method's own contract is being verified against here.
    jest.spyOn(service, 'findOne').mockResolvedValue({ id: 1 } as never);
  });

  it("promotes the newly appointed HoD's login role from faculty to hod", async () => {
    prisma.departments.findUnique.mockResolvedValue({
      id: 1,
      head_of_department_faculty_id: null,
    });
    prisma.faculty.findUnique.mockResolvedValue({
      id: 50,
      user_id: 500,
      department_id: 1,
    });
    tx.roles.findUniqueOrThrow.mockResolvedValue({ id: 3, name: 'hod' });

    await service.assignHod(1, { faculty_id: 50 }, 999);

    expect(tx.departments.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { head_of_department_faculty_id: 50 },
    });
    expect(tx.users.update).toHaveBeenCalledWith({
      where: { id: 500 },
      data: { role_id: 3 },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hod_assigned', entityId: 1 }),
    );
  });

  it('reverts the outgoing HoD back to the faculty role when replaced by someone else', async () => {
    prisma.departments.findUnique.mockResolvedValue({
      id: 1,
      head_of_department_faculty_id: 50,
    });
    prisma.faculty.findUnique
      .mockResolvedValueOnce({ id: 60, user_id: 600, department_id: 1 })
      .mockResolvedValueOnce({ user_id: 500 });
    tx.roles.findUniqueOrThrow
      .mockResolvedValueOnce({ id: 3, name: 'hod' })
      .mockResolvedValueOnce({ id: 4, name: 'faculty' });

    await service.assignHod(1, { faculty_id: 60 }, 999);

    expect(tx.users.update).toHaveBeenCalledWith({
      where: { id: 600 },
      data: { role_id: 3 },
    });
    expect(tx.users.update).toHaveBeenCalledWith({
      where: { id: 500 },
      data: { role_id: 4 },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hod_changed' }),
    );
  });

  it('reverts the outgoing HoD to faculty when the role is cleared entirely (faculty_id: null)', async () => {
    prisma.departments.findUnique.mockResolvedValue({
      id: 1,
      head_of_department_faculty_id: 50,
    });
    prisma.faculty.findUnique.mockResolvedValue({ user_id: 500 });
    tx.roles.findUniqueOrThrow.mockResolvedValue({ id: 4, name: 'faculty' });

    await service.assignHod(1, { faculty_id: null }, 999);

    expect(tx.departments.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { head_of_department_faculty_id: null },
    });
    expect(tx.users.update).toHaveBeenCalledWith({
      where: { id: 500 },
      data: { role_id: 4 },
    });
    expect(auditLog.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'hod_cleared' }),
    );
  });

  it('is a no-op (no transaction, no audit log) when the given faculty_id already is the current HoD', async () => {
    prisma.departments.findUnique.mockResolvedValue({
      id: 1,
      head_of_department_faculty_id: 50,
    });
    prisma.faculty.findUnique.mockResolvedValue({
      id: 50,
      user_id: 500,
      department_id: 1,
    });

    await service.assignHod(1, { faculty_id: 50 }, 999);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(auditLog.record).not.toHaveBeenCalled();
  });

  it('rejects a candidate who does not belong to this department', async () => {
    prisma.departments.findUnique.mockResolvedValue({
      id: 1,
      head_of_department_faculty_id: null,
    });
    prisma.faculty.findUnique.mockResolvedValue({
      id: 70,
      user_id: 700,
      department_id: 2,
    });

    await expect(
      service.assignHod(1, { faculty_id: 70 }, 999),
    ).rejects.toMatchObject({
      response: { errorCode: 'FACULTY_WRONG_DEPARTMENT' },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
