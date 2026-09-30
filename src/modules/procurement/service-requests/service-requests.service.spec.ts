jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { ServiceRequestsService } from './service-requests.service';

describe('ServiceRequestsService', () => {
  let service: ServiceRequestsService;
  let prisma: {
    departments: { findUnique: jest.Mock };
    faculty: { findUnique: jest.Mock };
    service_indents: { create: jest.Mock; update: jest.Mock };
    service_order_proposals: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    service_orders: { create: jest.Mock };
    $transaction: jest.Mock;
  };

  function proposalRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      vendor_id: null,
      status: 'pending',
      hod_reviewed_by: null,
      hod_reviewed_at: null,
      hod_remarks: null,
      finance_reviewed_by: null,
      finance_reviewed_at: null,
      finance_remarks: null,
      service_indents: {
        id: 10,
        title: 'AC repair',
        service_description: 'Two ACs not cooling',
        quantity: '6',
        location: 'Server room',
        needed_by: new Date('2026-08-10T00:00:00.000Z'),
        department_id: 2,
        created_at: new Date('2026-07-27T00:00:00.000Z'),
        departments: { id: 2, name: 'CSE' },
        users: { id: 5, email: 'secretary@sece.ac.in' },
      },
      users_service_order_proposals_hod_reviewed_byTousers: null,
      users_service_order_proposals_finance_reviewed_byTousers: null,
      service_orders: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      departments: { findUnique: jest.fn() },
      faculty: { findUnique: jest.fn() },
      service_indents: { create: jest.fn(), update: jest.fn() },
      service_order_proposals: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      service_orders: { create: jest.fn() },
      $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceRequestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: { notify: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();

    service = module.get<ServiceRequestsService>(ServiceRequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Admin, not Secretary — resolveEffectiveDepartmentId() short-circuits to
  // the requested department_id for any non-Secretary role without touching
  // non_teaching_staff, which this spec's mock prisma object doesn't stub.
  const adminUser = { sub: 5, email: 'admin@sece.ac.in', role: ROLES.ADMIN, roleId: 1 } as any;

  describe('create', () => {
    it('throws 404 when department_id does not exist', async () => {
      prisma.departments.findUnique.mockResolvedValue(null);

      await expect(
        service.create(
          { title: 'AC repair', service_description: 'x', department_id: 999 } as any,
          5,
          adminUser,
        ),
      ).rejects.toMatchObject({ response: { errorCode: 'DEPARTMENT_NOT_FOUND' } });
      expect(prisma.service_indents.create).not.toHaveBeenCalled();
    });

    it('creates a linked indent + proposal, always starting pending_hod', async () => {
      prisma.departments.findUnique.mockResolvedValue({ id: 2, name: 'CSE' });
      prisma.service_indents.create.mockResolvedValue({ id: 10 });
      prisma.service_order_proposals.create.mockResolvedValue(proposalRow());

      const result = await service.create(
        { title: 'AC repair', service_description: 'Two ACs not cooling', department_id: 2 } as any,
        5,
        adminUser,
      );

      expect(prisma.service_indents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requested_by_user_id: 5,
            department_id: 2,
            title: 'AC repair',
            service_description: 'Two ACs not cooling',
          }),
        }),
      );
      const [args] = prisma.service_order_proposals.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(args.data).toEqual({ indent_id: 10 });
      expect(result.status).toBe('pending_hod');
    });
  });

  describe('findAll', () => {
    it('scopes a SECRETARY caller to their own submissions', async () => {
      prisma.service_order_proposals.findMany.mockResolvedValue([]);

      await service.findAll(
        { limit: 20, page: 1, skip: 0 } as any,
        { sub: 5, role: ROLES.SECRETARY } as any,
      );

      const [args] = prisma.service_order_proposals.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toEqual({ service_indents: { requested_by_user_id: 5 } });
    });

    it("scopes a HOD caller to their own department", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });
      prisma.service_order_proposals.findMany.mockResolvedValue([]);

      await service.findAll(
        { limit: 20, page: 1, skip: 0 } as any,
        { sub: 23, role: ROLES.HOD } as any,
      );

      const [args] = prisma.service_order_proposals.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toEqual({ service_indents: { department_id: 2 } });
    });

    it('does not scope a FINANCE caller at all', async () => {
      prisma.service_order_proposals.findMany.mockResolvedValue([]);

      await service.findAll(
        { limit: 20, page: 1, skip: 0 } as any,
        { sub: 40, role: ROLES.FINANCE } as any,
      );

      expect(prisma.faculty.findUnique).not.toHaveBeenCalled();
      const [args] = prisma.service_order_proposals.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toEqual({});
    });
  });

  describe('findOne', () => {
    it('throws 403 when a SECRETARY caller requests a request that is not their own', async () => {
      prisma.service_order_proposals.findUnique.mockResolvedValue(proposalRow());

      await expect(
        service.findOne(1, { sub: 999, role: ROLES.SECRETARY } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'NOT_THE_REQUESTER' } });
    });

    it('throws 403 when a HOD caller requests a request from a different department', async () => {
      prisma.service_order_proposals.findUnique.mockResolvedValue(proposalRow());
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 99 });

      await expect(
        service.findOne(1, { sub: 23, role: ROLES.HOD } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'NOT_YOUR_DEPARTMENT' } });
    });
  });

  describe('hodReview', () => {
    it('throws 422 when the proposal is not pending', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });
      prisma.service_order_proposals.findUnique.mockResolvedValue({
        indent_id: 10,
        status: 'hod_approved',
        service_indents: { department_id: 2 },
      });

      await expect(
        service.hodReview(1, { decision: 'approved' } as any, { sub: 23, role: ROLES.HOD } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'INVALID_WORKFLOW_STATE' } });
    });

    it('forwards to Finance (hod_approved) on approve, mirroring the indent status', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });
      prisma.service_order_proposals.findUnique.mockResolvedValue({
        indent_id: 10,
        status: 'pending',
        service_indents: { department_id: 2 },
      });
      prisma.service_order_proposals.update.mockResolvedValue(
        proposalRow({ status: 'hod_approved', hod_reviewed_by: 23 }),
      );
      prisma.service_indents.update.mockResolvedValue({});

      const result = await service.hodReview(
        1,
        { decision: 'approved' } as any,
        { sub: 23, role: ROLES.HOD } as any,
      );

      expect(prisma.service_indents.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { status: 'hod_approved' },
      });
      expect(result.status).toBe('pending_finance');
    });
  });

  // financeReview/convert were removed from ServiceRequestsService
  // (2026-09-26, dead code — unreachable from any frontend page). Finance's
  // real decision now goes through FinanceApprovalsService.decide(), which
  // requires hod_approved and also places the order — see
  // src/modules/finance/approvals/approvals.service.spec.ts.
});
