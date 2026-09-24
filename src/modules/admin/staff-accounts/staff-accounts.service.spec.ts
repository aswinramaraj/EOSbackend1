jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditLogService } from 'src/common/audit-log/audit-log.service';
import { StaffAccountsService } from './staff-accounts.service';

describe('StaffAccountsService', () => {
  let service: StaffAccountsService;
  let auditLog: { record: jest.Mock };
  let tx: {
    users: { create: jest.Mock };
    non_teaching_staff: { create: jest.Mock };
  };
  let prisma: {
    users: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
    };
    roles: { findUnique: jest.Mock; findMany: jest.Mock };
    departments: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = {
      users: { create: jest.fn() },
      non_teaching_staff: { create: jest.fn() },
    };
    prisma = {
      users: {
        findUnique: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      roles: { findUnique: jest.fn(), findMany: jest.fn() },
      departments: { findUnique: jest.fn() },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb(tx),
      ),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StaffAccountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = module.get<StaffAccountsService>(StaffAccountsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates a plain users row for a role with no profile table (e.g. library)', async () => {
      prisma.users.findUnique.mockResolvedValue(null);
      prisma.roles.findUnique.mockResolvedValue({
        id: 23,
        name: 'library',
        description: 'Library Staff',
      });
      tx.users.create.mockResolvedValue({ id: 100 });

      const result = await service.create(
        { email: 'lib@test.local', role_name: 'library' },
        999,
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- bare jest.Mock, indexing .mock.calls is inherently untyped; the cast right after gives it a real shape
      const createCall = tx.users.create.mock.calls[0][0] as {
        data: { email: string; role_id: number; status: string };
      };
      expect(createCall.data.email).toBe('lib@test.local');
      expect(createCall.data.role_id).toBe(23);
      expect(createCall.data.status).toBe('active');
      expect(tx.non_teaching_staff.create).not.toHaveBeenCalled();
      expect(result.temporary_password).toEqual(expect.any(String));
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'staff_account_created',
          entityId: 100,
        }),
      );
    });

    it('also creates a non_teaching_staff row, department-linked, for secretary', async () => {
      prisma.users.findUnique.mockResolvedValue(null);
      prisma.roles.findUnique.mockResolvedValue({
        id: 28,
        name: 'secretary',
        description: 'Secretary',
      });
      prisma.departments.findUnique.mockResolvedValue({
        id: 5,
        name: 'CSE',
        code: 'CS',
      });
      tx.users.create.mockResolvedValue({ id: 200 });

      await service.create(
        {
          email: 'sec@test.local',
          role_name: 'secretary',
          first_name: 'Test',
          last_name: 'Sec',
          department_id: 5,
        },
        999,
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- bare jest.Mock, indexing .mock.calls is inherently untyped; the cast right after gives it a real shape
      const staffCall = tx.non_teaching_staff.create.mock.calls[0][0] as {
        data: {
          user_id: number;
          first_name: string;
          department_id: number;
          category: string;
        };
      };
      expect(staffCall.data.user_id).toBe(200);
      expect(staffCall.data.first_name).toBe('Test');
      expect(staffCall.data.department_id).toBe(5);
      expect(staffCall.data.category).toBe('other');
    });

    it('rejects a secretary account with no department_id', async () => {
      prisma.users.findUnique.mockResolvedValue(null);
      prisma.roles.findUnique.mockResolvedValue({
        id: 28,
        name: 'secretary',
        description: 'Secretary',
      });

      await expect(
        service.create(
          {
            email: 'sec2@test.local',
            role_name: 'secretary',
            first_name: 'X',
          },
          999,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects when the given department does not exist', async () => {
      prisma.users.findUnique.mockResolvedValue(null);
      prisma.roles.findUnique.mockResolvedValue({
        id: 28,
        name: 'secretary',
        description: 'Secretary',
      });
      prisma.departments.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          {
            email: 'sec3@test.local',
            role_name: 'secretary',
            first_name: 'X',
            department_id: 999,
          },
          999,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a duplicate email', async () => {
      prisma.users.findUnique.mockResolvedValue({ id: 1 });

      await expect(
        service.create({ email: 'dup@test.local', role_name: 'library' }, 999),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('deactivates an account and logs the change', async () => {
      prisma.users.findUnique.mockResolvedValue({
        id: 100,
        email: 'lib@test.local',
        status: 'active',
        roles: { name: 'library' },
      });

      const result = await service.updateStatus(100, 'inactive', 999);

      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: 100 },
        data: { status: 'inactive' },
      });
      expect(result).toEqual({ id: 100, status: 'inactive' });
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'staff_account_deactivated' }),
      );
    });

    it('rejects an account that is not one of the provisionable roles (e.g. admin)', async () => {
      prisma.users.findUnique.mockResolvedValue({
        id: 1,
        email: 'admin@test.local',
        status: 'active',
        roles: { name: 'admin' },
      });

      await expect(
        service.updateStatus(1, 'inactive', 999),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown account id', async () => {
      prisma.users.findUnique.mockResolvedValue(null);
      await expect(
        service.updateStatus(9999, 'inactive', 999),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('resetPassword', () => {
    const dto = { adminPassword: 'correct-horse' };

    it('rejects when the step-up password does not match the caller', async () => {
      prisma.users.findUnique.mockResolvedValueOnce({
        password_hash: 'not-a-match',
      });

      await expect(service.resetPassword(100, dto, 999)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.users.update).not.toHaveBeenCalled();
    });

    it('generates and persists a new temporary password once the step-up check passes', async () => {
      const { hashPassword } = jest.requireActual<
        typeof import('src/common/utils/credentials.util')
      >('src/common/utils/credentials.util');
      prisma.users.findUnique
        .mockResolvedValueOnce({ password_hash: hashPassword('correct-horse') }) // actor lookup
        .mockResolvedValueOnce({
          id: 100,
          email: 'lib@test.local',
          roles: { name: 'library' },
        }); // target lookup

      const result = await service.resetPassword(100, dto, 999);

      expect(prisma.users.update).toHaveBeenCalledWith({
        where: { id: 100 },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.any() is inherently `any`-typed; same jest+ts-eslint friction as elsewhere in this file
        data: { password_hash: expect.any(String) },
      });
      expect(typeof result.temporary_password).toBe('string');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'staff_account_password_reset',
          entityId: 100,
        }),
      );
    });
  });
});
