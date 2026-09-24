jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { PurchaseOrdersService } from './purchase-orders.service';

describe('PurchaseOrdersService', () => {
  let service: PurchaseOrdersService;
  let prisma: {
    purchase_orders: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
    };
    purchase_order_proposals: { findUnique: jest.Mock };
    users: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      purchase_orders: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      purchase_order_proposals: { findUnique: jest.fn() },
      users: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurchaseOrdersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PurchaseOrdersService>(PurchaseOrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    beforeEach(() => {
      prisma.purchase_order_proposals.findUnique.mockResolvedValue({ id: 75 });
      prisma.purchase_orders.findUnique.mockResolvedValue(null); // no existing PO for proposal_id / po_number
    });

    it("converts a date-only sent_to_vendor_at string into a real Date, so Prisma's DateTime column doesn't reject it (regression: this endpoint used to pass the raw string straight through and crash with 'premature end of input, Expected ISO-8601 DateTime')", async () => {
      prisma.purchase_orders.create.mockResolvedValue({ id: 1 });

      await service.create({
        proposal_id: 75,
        po_number: 'PO-2026-9999',
        sent_to_vendor_at: '2026-09-23',
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- bare jest.Mock, indexing .mock.calls is inherently untyped; the cast right after gives it a real shape
      const call = prisma.purchase_orders.create.mock.calls[0][0] as {
        data: { sent_to_vendor_at: unknown };
      };
      expect(call.data.sent_to_vendor_at).toBeInstanceOf(Date);
      expect((call.data.sent_to_vendor_at as Date).toISOString()).toBe(
        '2026-09-23T00:00:00.000Z',
      );
    });

    it('omits sent_to_vendor_at entirely when not provided', async () => {
      prisma.purchase_orders.create.mockResolvedValue({ id: 1 });

      await service.create({ proposal_id: 75, po_number: 'PO-2026-9999' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- bare jest.Mock, indexing .mock.calls is inherently untyped; the cast right after gives it a real shape
      const call = prisma.purchase_orders.create.mock.calls[0][0] as {
        data: { sent_to_vendor_at: unknown };
      };
      expect(call.data.sent_to_vendor_at).toBeUndefined();
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.purchase_orders.findUnique.mockResolvedValue({
        id: 23,
        proposal_id: 75,
        po_number: 'PO-2026-0008',
      });
    });

    it('converts a date-only sent_to_vendor_at string into a real Date', async () => {
      prisma.purchase_orders.update.mockResolvedValue({ id: 23 });

      await service.update(23, { sent_to_vendor_at: '2026-09-23' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- bare jest.Mock, indexing .mock.calls is inherently untyped; the cast right after gives it a real shape
      const call = prisma.purchase_orders.update.mock.calls[0][0] as {
        data: { sent_to_vendor_at: unknown };
      };
      expect(call.data.sent_to_vendor_at).toBeInstanceOf(Date);
    });

    it('still allows explicitly clearing sent_to_vendor_at back to null (must not be coerced into a no-op)', async () => {
      prisma.purchase_orders.update.mockResolvedValue({ id: 23 });

      await service.update(23, {
        sent_to_vendor_at: null as unknown as undefined,
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- bare jest.Mock, indexing .mock.calls is inherently untyped; the cast right after gives it a real shape
      const call = prisma.purchase_orders.update.mock.calls[0][0] as {
        data: { sent_to_vendor_at: unknown };
      };
      expect(call.data.sent_to_vendor_at).toBeNull();
    });
  });
});
