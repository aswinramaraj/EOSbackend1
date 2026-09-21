import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { CanteenOnlineOrdersService } from './canteen-online-orders.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { CanteenQueuePushService } from 'src/modules/canteen-queue/canteen-queue-push.service';

jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('CanteenOnlineOrdersService', () => {
  let service: CanteenOnlineOrdersService;
  let prisma: any;
  let queuePush: { pushKitchenUpdate: jest.Mock; pushCounterUpdate: jest.Mock };

  beforeEach(async () => {
    prisma = {
      canteen_orders: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
      canteen_bills: { create: jest.fn() },
    };
    queuePush = {
      pushKitchenUpdate: jest.fn(),
      pushCounterUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanteenOnlineOrdersService,
        { provide: PrismaService, useValue: prisma },
        { provide: CanteenQueuePushService, useValue: queuePush },
      ],
    }).compile();

    service = module.get<CanteenOnlineOrdersService>(
      CanteenOnlineOrdersService,
    );
  });

  describe('updateStatus', () => {
    it('pushes both a kitchen update and a counter update when a paid order becomes ready (the only real transition now)', async () => {
      prisma.canteen_orders.findUnique.mockResolvedValue({
        id: 1,
        order_source: 'self',
        status: 'placed',
      });
      prisma.canteen_orders.update.mockResolvedValue({});

      await service.updateStatus(1, { status: 'ready' } as any);

      expect(queuePush.pushKitchenUpdate).toHaveBeenCalledTimes(1);
      expect(queuePush.pushCounterUpdate).toHaveBeenCalledTimes(1);
    });

    it('pushes nothing when the transition is rejected (e.g. a stale click on an already-ready order)', async () => {
      prisma.canteen_orders.findUnique.mockResolvedValue({
        id: 1,
        order_source: 'self',
        status: 'ready',
      });

      await expect(
        service.updateStatus(1, { status: 'ready' } as any),
      ).rejects.toThrow(ConflictException);

      expect(prisma.canteen_orders.update).not.toHaveBeenCalled();
      expect(queuePush.pushKitchenUpdate).not.toHaveBeenCalled();
      expect(queuePush.pushCounterUpdate).not.toHaveBeenCalled();
    });
  });

  describe('generateBill (Mark Received)', () => {
    it('pushes a counter update once the ready order is billed and collected', async () => {
      prisma.canteen_orders.findUnique.mockResolvedValue({
        id: 1,
        order_source: 'self',
        status: 'ready',
        total_amount: 26.25,
        canteen_order_items: [{ is_parcel: false }],
      });
      prisma.canteen_bills.create.mockResolvedValue({ id: 99 });
      prisma.canteen_orders.update.mockResolvedValue({});

      await service.generateBill(1, 3);

      expect(queuePush.pushCounterUpdate).toHaveBeenCalledTimes(1);
    });

    it('pushes nothing when the order is not ready yet', async () => {
      prisma.canteen_orders.findUnique.mockResolvedValue({
        id: 1,
        order_source: 'self',
        status: 'placed',
      });

      await expect(service.generateBill(1, 3)).rejects.toThrow(
        ConflictException,
      );

      expect(queuePush.pushCounterUpdate).not.toHaveBeenCalled();
    });
  });
});
