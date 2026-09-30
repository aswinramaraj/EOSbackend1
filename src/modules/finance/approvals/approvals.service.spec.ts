jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
  Prisma: { Decimal: class Decimal { constructor(public value: unknown) {} } },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { FinanceAuditService } from '../finance-audit.service';
import { FinanceApprovalsService } from './approvals.service';

describe('FinanceApprovalsService', () => {
  let service: FinanceApprovalsService;
  let audit: { record: jest.Mock };
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      purchase_order_proposals: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      service_order_proposals: {
        findUnique: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
      },
      finance_funds: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      finance_ledger_entries: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      finance_proposal_assignments: {
        deleteMany: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      faculty: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      purchase_orders: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
      service_orders: { findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
      finance_order_tracking: { findUnique: jest.fn(), create: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinanceApprovalsService,
        { provide: PrismaService, useValue: prisma },
        { provide: FinanceAuditService, useValue: audit },
      ],
    }).compile();

    service = module.get(FinanceApprovalsService);
  });

  const ctx = { ip: '127.0.0.1', userAgent: 'test' };

  describe('decide — HoD-then-Finance ordering', () => {
    it('rejects with FINANCE_AWAITING_HOD when the HoD has not reviewed it yet', async () => {
      prisma.service_order_proposals.findUnique.mockResolvedValue({ id: 1, status: 'pending' });

      await expect(
        service.decide('sop', 1, { decision: 'approve', amount: 100 } as any, 42, ctx),
      ).rejects.toMatchObject({ response: { errorCode: 'FINANCE_AWAITING_HOD' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects with FINANCE_PROPOSAL_ALREADY_DECIDED when Finance already acted', async () => {
      prisma.service_order_proposals.findUnique.mockResolvedValue({ id: 1, status: 'finance_approved' });

      await expect(
        service.decide('sop', 1, { decision: 'approve', amount: 100 } as any, 42, ctx),
      ).rejects.toMatchObject({ response: { errorCode: 'FINANCE_PROPOSAL_ALREADY_DECIDED' } });
    });

    it('approves a hod_approved proposal, debits the fund, and places the order', async () => {
      prisma.service_order_proposals.findUnique.mockResolvedValue({ id: 1, status: 'hod_approved' });
      prisma.finance_funds.findFirst.mockResolvedValue({ id: 9, is_locked: false });
      prisma.service_order_proposals.updateMany.mockResolvedValue({ count: 1 });
      prisma.service_order_proposals.findUniqueOrThrow.mockResolvedValue({ id: 1, status: 'finance_approved' });
      prisma.service_orders.findUnique.mockResolvedValue(null);
      prisma.service_orders.findFirst.mockResolvedValue(null);
      prisma.service_orders.create.mockResolvedValue({ id: 55 });
      prisma.finance_order_tracking.findUnique.mockResolvedValue(null);
      prisma.finance_funds.findUniqueOrThrow.mockResolvedValue({ available_amount: 5000 });

      const result = await service.decide('sop', 1, { decision: 'approve', amount: 1000 } as any, 42, ctx);

      expect(prisma.service_order_proposals.updateMany).toHaveBeenCalledWith({
        where: { id: 1, status: 'hod_approved' },
        data: expect.objectContaining({ status: 'finance_approved' }),
      });
      expect(prisma.finance_ledger_entries.create).toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sop.approved', before: { status: 'hod_approved' } }),
      );
      expect(result).toMatchObject({ status: 'finance_approved', approved_amount: 1000 });
    });

    it('409s when a concurrent caller already claimed the hod_approved row', async () => {
      prisma.service_order_proposals.findUnique.mockResolvedValue({ id: 1, status: 'hod_approved' });
      prisma.finance_funds.findFirst.mockResolvedValue({ id: 9, is_locked: false });
      prisma.service_order_proposals.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.decide('sop', 1, { decision: 'approve', amount: 1000 } as any, 42, ctx),
      ).rejects.toThrow('This proposal was decided by someone else a moment ago');
    });

    it('rejects a hod_approved proposal without touching the fund', async () => {
      prisma.service_order_proposals.findUnique.mockResolvedValue({ id: 1, status: 'hod_approved' });
      prisma.service_order_proposals.update.mockResolvedValue({ id: 1, status: 'rejected' });

      const result = await service.decide(
        'sop',
        1,
        { decision: 'reject', remarks: 'Not needed' } as any,
        42,
        ctx,
      );

      expect(prisma.finance_ledger_entries.create).not.toHaveBeenCalled();
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'sop.rejected', before: { status: 'hod_approved' } }),
      );
      expect(result).toMatchObject({ status: 'rejected', approved_amount: null });
    });
  });
});
