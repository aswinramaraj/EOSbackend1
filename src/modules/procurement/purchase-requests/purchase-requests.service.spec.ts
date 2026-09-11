jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { PurchaseRequestsService } from './purchase-requests.service';

describe('PurchaseRequestsService', () => {
  let service: PurchaseRequestsService;
  let prisma: {
    departments: { findUnique: jest.Mock };
    faculty: { findUnique: jest.Mock };
    purchase_indents: { create: jest.Mock; update: jest.Mock };
    purchase_order_proposals: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    purchase_orders: { create: jest.Mock };
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
      purchase_indents: {
        id: 10,
        item_name: 'GPU workstation',
        quantity: 2,
        purpose: 'Deep learning workloads',
        needed_by: new Date('2026-08-20T00:00:00.000Z'),
        department_id: 2,
        created_at: new Date('2026-07-30T00:00:00.000Z'),
        departments: { id: 2, name: 'CSE' },
        users: { id: 5, email: 'secretary@sece.ac.in' },
      },
      users_purchase_order_proposals_hod_reviewed_byTousers: null,
      users_purchase_order_proposals_finance_reviewed_byTousers: null,
      purchase_orders: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      departments: { findUnique: jest.fn() },
      faculty: { findUnique: jest.fn() },
      purchase_indents: { create: jest.fn(), update: jest.fn() },
      purchase_order_proposals: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      purchase_orders: { create: jest.fn() },
      $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseRequestsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PurchaseRequestsService>(PurchaseRequestsService);
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
        service.create({ item_name: 'x', department_id: 999, quantity: 1 } as any, 5, adminUser),
      ).rejects.toMatchObject({ response: { errorCode: 'DEPARTMENT_NOT_FOUND' } });
      expect(prisma.purchase_indents.create).not.toHaveBeenCalled();
    });

    it('creates a linked indent + proposal, always starting pending_hod', async () => {
      prisma.departments.findUnique.mockResolvedValue({ id: 2, name: 'CSE' });
      prisma.purchase_indents.create.mockResolvedValue({ id: 10 });
      prisma.purchase_order_proposals.create.mockResolvedValue(proposalRow());

      const result = await service.create(
        { item_name: 'GPU workstation', department_id: 2, quantity: 2 } as any,
        5,
        adminUser,
      );

      expect(prisma.purchase_indents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requested_by_user_id: 5,
            department_id: 2,
            item_name: 'GPU workstation',
            quantity: 2,
          }),
        }),
      );
      const [args] = prisma.purchase_order_proposals.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(args.data).toEqual({ indent_id: 10 });
      expect(result.status).toBe('pending_hod');
    });
  });

  describe('findAll', () => {
    it('scopes a SECRETARY caller to their own submissions', async () => {
      prisma.purchase_order_proposals.findMany.mockResolvedValue([]);

      await service.findAll(
        { limit: 20, page: 1, skip: 0 } as any,
        { sub: 5, role: ROLES.SECRETARY } as any,
      );

      const [args] = prisma.purchase_order_proposals.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toEqual({ purchase_indents: { requested_by_user_id: 5 } });
    });

    it("scopes a HOD caller to their own department, via the caller's own faculty row", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });
      prisma.purchase_order_proposals.findMany.mockResolvedValue([]);

      await service.findAll(
        { limit: 20, page: 1, skip: 0 } as any,
        { sub: 23, role: ROLES.HOD } as any,
      );

      const [args] = prisma.purchase_order_proposals.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toEqual({ purchase_indents: { department_id: 2 } });
    });

    it('does not scope a FINANCE caller at all', async () => {
      prisma.purchase_order_proposals.findMany.mockResolvedValue([]);

      await service.findAll(
        { limit: 20, page: 1, skip: 0 } as any,
        { sub: 40, role: ROLES.FINANCE } as any,
      );

      expect(prisma.faculty.findUnique).not.toHaveBeenCalled();
      const [args] = prisma.purchase_order_proposals.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toEqual({});
    });

    it('derives status from proposal fields and filters by the derived status', async () => {
      prisma.purchase_order_proposals.findMany.mockResolvedValue([
        proposalRow({ id: 1, status: 'pending' }),
        proposalRow({ id: 2, status: 'hod_approved', hod_reviewed_by: 15 }),
        proposalRow({
          id: 3,
          status: 'rejected',
          hod_reviewed_by: 15,
        }),
        proposalRow({
          id: 4,
          status: 'rejected',
          hod_reviewed_by: 15,
          finance_reviewed_by: 9,
        }),
        proposalRow({
          id: 5,
          status: 'finance_approved',
          hod_reviewed_by: 15,
          finance_reviewed_by: 9,
        }),
        proposalRow({
          id: 6,
          status: 'finance_approved',
          hod_reviewed_by: 15,
          finance_reviewed_by: 9,
          purchase_orders: { po_number: 'PO-2026-0006', created_at: new Date() },
        }),
      ]);

      const all = await service.findAll(
        { limit: 20, page: 1, skip: 0 } as any,
        { sub: 40, role: ROLES.FINANCE } as any,
      );
      expect(all.data.map((r: any) => r.status)).toEqual([
        'pending_hod',
        'pending_finance',
        'rejected_by_hod',
        'rejected_by_finance',
        'approved',
        'converted',
      ]);

      const rejectedByFinanceOnly = await service.findAll(
        { limit: 20, page: 1, skip: 0, status: 'rejected_by_finance' } as any,
        { sub: 40, role: ROLES.FINANCE } as any,
      );
      expect(rejectedByFinanceOnly.data).toHaveLength(1);
      expect(rejectedByFinanceOnly.data[0]).toMatchObject({ id: 4, status: 'rejected_by_finance' });
    });
  });

  describe('findOne', () => {
    it('throws 403 when a SECRETARY caller requests a request that is not their own', async () => {
      prisma.purchase_order_proposals.findUnique.mockResolvedValue(proposalRow());

      await expect(
        service.findOne(1, { sub: 999, role: ROLES.SECRETARY } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'NOT_THE_REQUESTER' } });
    });

    it('throws 403 when a HOD caller requests a request from a different department', async () => {
      prisma.purchase_order_proposals.findUnique.mockResolvedValue(proposalRow());
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 99 });

      await expect(
        service.findOne(1, { sub: 23, role: ROLES.HOD } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'NOT_YOUR_DEPARTMENT' } });
    });

    it('allows a HOD caller to view a request from their own department', async () => {
      prisma.purchase_order_proposals.findUnique.mockResolvedValue(proposalRow());
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });

      const result = await service.findOne(1, { sub: 23, role: ROLES.HOD } as any);
      expect(result.id).toBe(1);
    });
  });

  describe('hodReview', () => {
    it('throws 403 when the request is from a different department', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 99 });
      prisma.purchase_order_proposals.findUnique.mockResolvedValue({
        indent_id: 10,
        status: 'pending',
        purchase_indents: { department_id: 2 },
      });

      await expect(
        service.hodReview(1, { decision: 'approved' } as any, { sub: 23, role: ROLES.HOD } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'NOT_YOUR_DEPARTMENT' } });
      expect(prisma.purchase_order_proposals.update).not.toHaveBeenCalled();
    });

    it('throws 422 when the proposal is not pending', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });
      prisma.purchase_order_proposals.findUnique.mockResolvedValue({
        indent_id: 10,
        status: 'hod_approved',
        purchase_indents: { department_id: 2 },
      });

      await expect(
        service.hodReview(1, { decision: 'approved' } as any, { sub: 23, role: ROLES.HOD } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'INVALID_WORKFLOW_STATE' } });
    });

    it('forwards to Finance (hod_approved) on approve, mirroring the indent status', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });
      prisma.purchase_order_proposals.findUnique.mockResolvedValue({
        indent_id: 10,
        status: 'pending',
        purchase_indents: { department_id: 2 },
      });
      prisma.purchase_order_proposals.update.mockResolvedValue(
        proposalRow({ status: 'hod_approved', hod_reviewed_by: 23 }),
      );
      prisma.purchase_indents.update.mockResolvedValue({});

      const result = await service.hodReview(
        1,
        { decision: 'approved' } as any,
        { sub: 23, role: ROLES.HOD } as any,
      );

      expect(prisma.purchase_order_proposals.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: {
            status: 'hod_approved',
            hod_reviewed_by: 23,
            hod_reviewed_at: expect.any(Date),
            hod_remarks: undefined,
          },
        }),
      );
      expect(prisma.purchase_indents.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { status: 'hod_approved' },
      });
      expect(result.status).toBe('pending_finance');
    });

    it('rejects (terminal) with remarks recorded', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });
      prisma.purchase_order_proposals.findUnique.mockResolvedValue({
        indent_id: 10,
        status: 'pending',
        purchase_indents: { department_id: 2 },
      });
      prisma.purchase_order_proposals.update.mockResolvedValue(
        proposalRow({ status: 'rejected', hod_reviewed_by: 23 }),
      );
      prisma.purchase_indents.update.mockResolvedValue({});

      await service.hodReview(
        1,
        { decision: 'rejected', remarks: 'Not enough budget' } as any,
        { sub: 23, role: ROLES.HOD } as any,
      );

      expect(prisma.purchase_order_proposals.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            status: 'rejected',
            hod_reviewed_by: 23,
            hod_reviewed_at: expect.any(Date),
            hod_remarks: 'Not enough budget',
          },
        }),
      );
    });
  });

  describe('financeReview', () => {
    it('throws 422 when the proposal is not hod_approved', async () => {
      prisma.purchase_order_proposals.findUnique.mockResolvedValue({ indent_id: 10, status: 'pending' });

      await expect(
        service.financeReview(1, { decision: 'approved' } as any, 40),
      ).rejects.toMatchObject({ response: { errorCode: 'INVALID_WORKFLOW_STATE' } });
    });

    it('sets finance_approved on approve, mirroring the indent status', async () => {
      prisma.purchase_order_proposals.findUnique.mockResolvedValue({
        indent_id: 10,
        status: 'hod_approved',
      });
      prisma.purchase_order_proposals.update.mockResolvedValue(
        proposalRow({ status: 'finance_approved', hod_reviewed_by: 23, finance_reviewed_by: 40 }),
      );
      prisma.purchase_indents.update.mockResolvedValue({});

      const result = await service.financeReview(1, { decision: 'approved' } as any, 40);

      expect(prisma.purchase_order_proposals.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            status: 'finance_approved',
            finance_reviewed_by: 40,
            finance_reviewed_at: expect.any(Date),
            finance_remarks: undefined,
          },
        }),
      );
      expect(prisma.purchase_indents.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { status: 'finance_approved' },
      });
      expect(result.status).toBe('approved');
    });

    it('rejects (terminal) on reject', async () => {
      prisma.purchase_order_proposals.findUnique.mockResolvedValue({
        indent_id: 10,
        status: 'hod_approved',
      });
      prisma.purchase_order_proposals.update.mockResolvedValue(
        proposalRow({ status: 'rejected', hod_reviewed_by: 23, finance_reviewed_by: 40 }),
      );
      prisma.purchase_indents.update.mockResolvedValue({});

      const result = await service.financeReview(1, { decision: 'rejected' } as any, 40);
      expect(result.status).toBe('rejected_by_finance');
    });
  });

  describe('convert', () => {
    it('throws 422 when already converted', async () => {
      prisma.purchase_order_proposals.findUnique.mockResolvedValue({
        indent_id: 10,
        status: 'finance_approved',
        purchase_orders: { po_number: 'PO-2026-0001' },
      });

      await expect(service.convert(1, 3)).rejects.toMatchObject({
        response: { errorCode: 'INVALID_WORKFLOW_STATE' },
      });
      expect(prisma.purchase_orders.create).not.toHaveBeenCalled();
    });

    it('throws 422 when not finance_approved', async () => {
      prisma.purchase_order_proposals.findUnique.mockResolvedValue({
        indent_id: 10,
        status: 'hod_approved',
        purchase_orders: null,
      });

      await expect(service.convert(1, 3)).rejects.toMatchObject({
        response: { errorCode: 'INVALID_WORKFLOW_STATE' },
      });
    });

    it('creates a purchase_orders row with a PO-{year}-{id} number and mirrors the indent status', async () => {
      prisma.purchase_order_proposals.findUnique
        .mockResolvedValueOnce({ indent_id: 10, status: 'finance_approved', purchase_orders: null })
        .mockResolvedValueOnce(
          proposalRow({
            status: 'finance_approved',
            hod_reviewed_by: 23,
            finance_reviewed_by: 40,
            purchase_orders: { po_number: `PO-${new Date().getFullYear()}-0001`, created_at: new Date() },
          }),
        );
      prisma.purchase_orders.create.mockResolvedValue({});
      prisma.purchase_indents.update.mockResolvedValue({});

      const result = await service.convert(1, 3);

      const [args] = prisma.purchase_orders.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(args.data).toMatchObject({
        proposal_id: 1,
        po_number: `PO-${new Date().getFullYear()}-0001`,
        approved_by_user_id: 3,
      });
      expect(prisma.purchase_indents.update).toHaveBeenCalledWith({
        where: { id: 10 },
        data: { status: 'order_created' },
      });
      expect(result.status).toBe('converted');
    });
  });
});
