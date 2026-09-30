jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { DepartmentsService } from 'src/modules/academic-structure/departments/departments.service';
import { CoursesService } from 'src/modules/academic-structure/courses/courses.service';
import { BatchesService } from 'src/modules/academic-structure/batches/batches.service';
import { ClassesService } from 'src/modules/academic-structure/classes/classes.service';
import { AcademicCoordinatorMappingService } from 'src/modules/academic-coordinator/mapping/academic-coordinator-mapping.service';
import { MasterDataApprovalService } from './master-data-approval.service';

function requestRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    entity_type: 'department',
    action: 'create',
    department_id: null,
    payload: { name: 'Mechanical', code: 'MECH' },
    status: 'pending',
    requested_by_user_id: 10,
    requested_at: new Date('2026-09-25T10:00:00.000Z'),
    reviewed_by_user_id: null,
    reviewed_at: null,
    rejection_reason: null,
    created_entity_id: null,
    ...overrides,
  };
}

describe('MasterDataApprovalService', () => {
  let service: MasterDataApprovalService;
  let notifications: { notify: jest.Mock };
  let departments: { create: jest.Mock };
  let mapping: { addMapping: jest.Mock; removeMapping: jest.Mock };
  let prisma: {
    faculty: { findUnique: jest.Mock };
    users: { findMany: jest.Mock };
    $queryRawUnsafe: jest.Mock;
    $executeRawUnsafe: jest.Mock;
  };

  const principal = { sub: 1, email: 'p@eos.test', role: 'principal', roleId: 2 };
  const hod = { sub: 2, email: 'h@eos.test', role: 'hod', roleId: 4 };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      users: { findMany: jest.fn().mockResolvedValue([]) },
      $queryRawUnsafe: jest.fn(),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };
    departments = { create: jest.fn().mockResolvedValue({ id: 99 }) };
    mapping = {
      addMapping: jest.fn().mockResolvedValue({ added: 3, already_mapped: 0, total_classes: 3 }),
      removeMapping: jest.fn().mockResolvedValue({ removed: 3 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MasterDataApprovalService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
        { provide: DepartmentsService, useValue: departments },
        { provide: CoursesService, useValue: { create: jest.fn() } },
        { provide: BatchesService, useValue: { create: jest.fn() } },
        { provide: ClassesService, useValue: { create: jest.fn() } },
        { provide: AcademicCoordinatorMappingService, useValue: mapping },
      ],
    }).compile();

    service = module.get(MasterDataApprovalService);
  });

  describe('submit', () => {
    it('inserts a pending request and notifies Principal-role users for a department request', async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ id: 1 }]); // INSERT ... RETURNING id
      prisma.$queryRawUnsafe.mockResolvedValueOnce([requestRow()]); // loadRow
      prisma.users.findMany.mockResolvedValue([{ id: 501 }]);

      const result = await service.submit(
        'department',
        'create',
        { name: 'Mechanical', code: 'MECH' },
        10,
        null,
      );

      expect(result).toMatchObject({ id: 1, status: 'pending', entity_type: 'department' });
      expect(prisma.users.findMany).toHaveBeenCalledWith({
        where: { roles: { name: 'principal' } },
        select: { id: true },
      } as never);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 501, type: 'approval_request_pending' }),
      );
    });

    it('scopes reviewer notification to HOD-role users of the request department for curriculum_mapping', async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ id: 2 }]);
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        requestRow({
          id: 2,
          entity_type: 'curriculum_mapping',
          action: 'add_mapping',
          department_id: 7,
          payload: { department_id: 7, semester: 3, subject_id: 55 },
        }),
      ]);

      await service.submit(
        'curriculum_mapping',
        'add_mapping',
        { department_id: 7, semester: 3, subject_id: 55 },
        11,
        7,
      );

      expect(prisma.users.findMany).toHaveBeenCalledWith({
        where: { roles: { name: 'hod' }, faculty: { department_id: 7 } },
        select: { id: true },
      } as never);
    });

    it('throws FEATURE_NOT_ENABLED when the staging table does not exist yet', async () => {
      prisma.$queryRawUnsafe.mockRejectedValueOnce({
        code: 'P2010',
        meta: { code: '42P01', message: 'relation "master_data_change_requests" does not exist' },
      });

      await expect(
        service.submit('department', 'create', { name: 'X', code: 'X' }, 10, null),
      ).rejects.toMatchObject({ response: { errorCode: 'FEATURE_NOT_ENABLED' } });
    });
  });

  describe('listPending', () => {
    it('returns an empty list for a role with no reviewer standing', async () => {
      const result = await service.listPending({
        sub: 99,
        email: 'x@eos.test',
        role: 'faculty',
        roleId: 5,
      } as never);
      expect(result).toEqual([]);
      expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
    });

    it('scopes HOD to their own department only', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ department_id: 7 });
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        requestRow({ id: 2, entity_type: 'curriculum_mapping', department_id: 7 }),
      ]);

      const result = await service.listPending(hod as never);

      expect(result).toHaveLength(1);
      expect(prisma.$queryRawUnsafe.mock.calls[0][0]).toContain(
        "entity_type = 'curriculum_mapping'",
      );
      expect(prisma.$queryRawUnsafe.mock.calls[0][1]).toBe(7);
    });
  });

  describe('approve', () => {
    it('creates the real department via DepartmentsService.create and records created_entity_id', async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([requestRow()]); // loadRowForReview
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        requestRow({ status: 'approved', reviewed_by_user_id: 1, created_entity_id: 99 }),
      ]); // loadRow after update

      const result = await service.approve(1, principal as never);

      expect(departments.create).toHaveBeenCalledWith(
        { name: 'Mechanical', code: 'MECH' },
        10,
      );
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'approved'"),
        1,
        99,
        1,
      );
      expect(result).toMatchObject({ status: 'approved', created_entity_id: 99 });
    });

    it('rejects a non-Principal reviewer for a master-data request', async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([requestRow()]);

      await expect(service.approve(1, hod as never)).rejects.toThrow(
        'Only the Principal may review master-data requests',
      );
      expect(departments.create).not.toHaveBeenCalled();
    });

    it('rejects a HOD reviewing another department\'s curriculum_mapping request', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ department_id: 3 });
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        requestRow({ entity_type: 'curriculum_mapping', department_id: 7 }),
      ]);

      await expect(service.approve(1, hod as never)).rejects.toThrow(
        'You may only review requests for your own department',
      );
      expect(mapping.addMapping).not.toHaveBeenCalled();
    });

    it('409s when the request has already been decided', async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([requestRow({ status: 'approved' })]);

      await expect(service.approve(1, principal as never)).rejects.toMatchObject({
        response: { errorCode: 'REQUEST_ALREADY_DECIDED' },
      });
    });

    it('applies removeMapping for an approved remove_mapping curriculum request', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ department_id: 7 });
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        requestRow({
          entity_type: 'curriculum_mapping',
          action: 'remove_mapping',
          department_id: 7,
          payload: { department_id: 7, semester: 3, subject_id: 55 },
        }),
      ]);
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        requestRow({ entity_type: 'curriculum_mapping', status: 'approved' }),
      ]);

      await service.approve(1, hod as never);

      expect(mapping.removeMapping).toHaveBeenCalledWith(7, 3, 55);
    });
  });

  describe('reject', () => {
    it('records the rejection reason and notifies the requester', async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([requestRow()]);
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        requestRow({ status: 'rejected', rejection_reason: 'Duplicate department' }),
      ]);

      const result = await service.reject(1, principal as never, 'Duplicate department');

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'rejected'"),
        1,
        'Duplicate department',
        1,
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'approval_request_rejected' }),
      );
      expect(result.status).toBe('rejected');
    });
  });
});
