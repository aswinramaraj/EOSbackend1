jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditLogService } from 'src/common/audit-log/audit-log.service';
import { ParentAccountsService } from './parent-accounts.service';

describe('ParentAccountsService', () => {
  let service: ParentAccountsService;
  let auditLog: { record: jest.Mock };
  let tx: {
    users: { create: jest.Mock };
    parent_student_mapping: { create: jest.Mock };
  };
  let prisma: {
    students: { findUnique: jest.Mock };
    users: { findUnique: jest.Mock; findMany: jest.Mock };
    roles: { findUniqueOrThrow: jest.Mock };
    parent_student_mapping: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    tx = {
      users: { create: jest.fn() },
      parent_student_mapping: { create: jest.fn() },
    };
    prisma = {
      students: { findUnique: jest.fn().mockResolvedValue({ id: 5 }) },
      users: { findUnique: jest.fn(), findMany: jest.fn() },
      roles: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 7, name: 'parent' }) },
      parent_student_mapping: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParentAccountsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = module.get(ParentAccountsService);
  });

  describe('create', () => {
    it('creates a users row (role=parent) and a parent_student_mapping row in one transaction', async () => {
      prisma.users.findUnique.mockResolvedValue(null);
      tx.users.create.mockResolvedValue({ id: 501 });

      const result = await service.create(
        5,
        { email: 'parent@example.com', relationship: 'father' } as any,
        42,
      );

      expect(tx.users.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ email: 'parent@example.com', role_id: 7, status: 'active' }),
        }),
      );
      expect(tx.parent_student_mapping.create).toHaveBeenCalledWith({
        data: { parent_user_id: 501, student_id: 5, relationship: 'father' },
      });
      expect(result.temporary_password).toBeTruthy();
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'parent_account_created', entityId: 501 }),
      );
    });

    it('409s when the email is already registered', async () => {
      prisma.users.findUnique.mockResolvedValue({ id: 999 });

      await expect(
        service.create(5, { email: 'taken@example.com', relationship: 'father' } as any, 42),
      ).rejects.toMatchObject({ response: { errorCode: 'EMAIL_EXISTS' } });
      expect(tx.users.create).not.toHaveBeenCalled();
    });

    it('404s when the student does not exist', async () => {
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(
        service.create(999, { email: 'x@example.com', relationship: 'father' } as any, 42),
      ).rejects.toMatchObject({ response: { errorCode: 'STUDENT_NOT_FOUND' } });
    });
  });

  describe('link', () => {
    it('links an existing parent-role user to another student', async () => {
      prisma.users.findUnique.mockResolvedValue({ id: 501, roles: { name: 'parent' } });
      prisma.parent_student_mapping.findUnique.mockResolvedValue(null);

      const result = await service.link(6, { parent_user_id: 501, relationship: 'mother' } as any, 42);

      expect(prisma.parent_student_mapping.create).toHaveBeenCalledWith({
        data: { parent_user_id: 501, student_id: 6, relationship: 'mother' },
      });
      expect(result).toMatchObject({ id: 501, student_id: 6, relationship: 'mother' });
    });

    it('404s when the target user is not a parent-role account', async () => {
      prisma.users.findUnique.mockResolvedValue({ id: 501, roles: { name: 'faculty' } });

      await expect(
        service.link(6, { parent_user_id: 501, relationship: 'mother' } as any, 42),
      ).rejects.toMatchObject({ response: { errorCode: 'PARENT_NOT_FOUND' } });
    });

    it('409s when this parent is already linked to this student', async () => {
      prisma.users.findUnique.mockResolvedValue({ id: 501, roles: { name: 'parent' } });
      prisma.parent_student_mapping.findUnique.mockResolvedValue({ id: 1 });

      await expect(
        service.link(6, { parent_user_id: 501, relationship: 'mother' } as any, 42),
      ).rejects.toMatchObject({ response: { errorCode: 'MAPPING_EXISTS' } });
      expect(prisma.parent_student_mapping.create).not.toHaveBeenCalled();
    });
  });

  describe('unlink', () => {
    it('removes the mapping without touching the users row', async () => {
      prisma.parent_student_mapping.findUnique.mockResolvedValue({ relationship: 'father' });

      await service.unlink(5, 501, 42);

      expect(prisma.parent_student_mapping.delete).toHaveBeenCalledWith({
        where: { parent_user_id_student_id: { parent_user_id: 501, student_id: 5 } },
      });
      expect(prisma.users.findUnique).not.toHaveBeenCalled();
    });

    it('404s when the mapping does not exist', async () => {
      prisma.parent_student_mapping.findUnique.mockResolvedValue(null);

      await expect(service.unlink(5, 501, 42)).rejects.toMatchObject({
        response: { errorCode: 'MAPPING_NOT_FOUND' },
      });
    });
  });

  describe('search', () => {
    it('scopes results to parent-role users only', async () => {
      prisma.users.findMany.mockResolvedValue([]);

      await service.search('22IT101');

      expect(prisma.users.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ roles: { name: 'parent' } }),
        }),
      );
    });
  });
});
