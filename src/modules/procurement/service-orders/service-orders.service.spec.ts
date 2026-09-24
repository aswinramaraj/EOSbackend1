jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { ServiceOrdersService } from './service-orders.service';

describe('ServiceOrdersService', () => {
  let service: ServiceOrdersService;
  let prisma: {
    service_orders: {
      create: jest.Mock;
      update: jest.Mock;
      findUnique: jest.Mock;
    };
    service_order_proposals: { findUnique: jest.Mock };
    users: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      service_orders: {
        create: jest.fn(),
        update: jest.fn(),
        findUnique: jest.fn(),
      },
      service_order_proposals: { findUnique: jest.fn() },
      users: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceOrdersService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ServiceOrdersService>(ServiceOrdersService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    beforeEach(() => {
      prisma.service_order_proposals.findUnique.mockResolvedValue({ id: 10 });
      prisma.service_orders.findUnique.mockResolvedValue(null);
    });

    it("converts a date-only sent_to_vendor_at string into a real Date (same regression as purchase-orders — Prisma's DateTime column rejects a bare date string)", async () => {
      prisma.service_orders.create.mockResolvedValue({ id: 1 });

      await service.create({
        proposal_id: 10,
        so_number: 'SO-2026-9999',
        sent_to_vendor_at: '2026-09-23',
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- bare jest.Mock, indexing .mock.calls is inherently untyped; the cast right after gives it a real shape
      const call = prisma.service_orders.create.mock.calls[0][0] as {
        data: { sent_to_vendor_at: unknown };
      };
      expect(call.data.sent_to_vendor_at).toBeInstanceOf(Date);
    });
  });

  describe('update', () => {
    beforeEach(() => {
      prisma.service_orders.findUnique.mockResolvedValue({
        id: 5,
        proposal_id: 10,
        so_number: 'SO-2026-0001',
      });
    });

    it('converts a date-only sent_to_vendor_at string into a real Date', async () => {
      prisma.service_orders.update.mockResolvedValue({ id: 5 });

      await service.update(5, { sent_to_vendor_at: '2026-09-23' });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- bare jest.Mock, indexing .mock.calls is inherently untyped; the cast right after gives it a real shape
      const call = prisma.service_orders.update.mock.calls[0][0] as {
        data: { sent_to_vendor_at: unknown };
      };
      expect(call.data.sent_to_vendor_at).toBeInstanceOf(Date);
    });

    it('still allows explicitly clearing sent_to_vendor_at back to null', async () => {
      prisma.service_orders.update.mockResolvedValue({ id: 5 });

      await service.update(5, {
        sent_to_vendor_at: null as unknown as undefined,
      });

      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access -- bare jest.Mock, indexing .mock.calls is inherently untyped; the cast right after gives it a real shape
      const call = prisma.service_orders.update.mock.calls[0][0] as {
        data: { sent_to_vendor_at: unknown };
      };
      expect(call.data.sent_to_vendor_at).toBeNull();
    });
  });
});
