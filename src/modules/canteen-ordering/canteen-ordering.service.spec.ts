import { Test, TestingModule } from '@nestjs/testing';
import { CanteenOrderingService } from './canteen-ordering.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { CanteenSettingsService } from 'src/modules/canteen-admin/canteen-settings.service';
import { WalletService } from 'src/modules/wallet/wallet.service';
import { CanteenQueuePushService } from 'src/modules/canteen-queue/canteen-queue-push.service';

jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

const DISH = {
  id: 1,
  name: 'Cold Drink',
  category_id: 2,
  price: 25 as unknown,
  stock_quantity: 10,
  is_available: true,
  parcel_available: true,
};

describe('CanteenOrderingService', () => {
  let service: CanteenOrderingService;
  let prisma: any;
  let wallet: { debitForPurchase: jest.Mock; refundPurchase: jest.Mock };
  let queuePush: { pushKitchenUpdate: jest.Mock; pushCounterUpdate: jest.Mock };

  beforeEach(async () => {
    prisma = {
      canteen_dishes: { findMany: jest.fn().mockResolvedValue([DISH]) },
      wallet_outlets: {
        findFirstOrThrow: jest.fn().mockResolvedValue({ id: 1 }),
      },
      canteen_orders: { findMany: jest.fn(), findUnique: jest.fn() },
      $queryRaw: jest.fn(),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    wallet = {
      debitForPurchase: jest
        .fn()
        .mockResolvedValue({ transactionId: 55, balance: 100 }),
      refundPurchase: jest.fn().mockResolvedValue(undefined),
    };
    queuePush = {
      pushKitchenUpdate: jest.fn(),
      pushCounterUpdate: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanteenOrderingService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: CanteenSettingsService,
          useValue: {
            get: jest
              .fn()
              .mockResolvedValue({ gst_percentage: 0, parcel_charge: 0 }),
          },
        },
        { provide: WalletService, useValue: wallet },
        { provide: CanteenQueuePushService, useValue: queuePush },
      ],
    }).compile();

    service = module.get<CanteenOrderingService>(CanteenOrderingService);
  });

  describe('placeOrder', () => {
    const dto = { items: [{ dish_id: 1, quantity: 1 }] } as any;

    it('retries with a fresh token when the day-scoped token collides, and only broadcasts once it lands', async () => {
      prisma.canteen_dishes.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });
      prisma.canteen_order_items = { createMany: jest.fn() };
      // First draw collides with an order already placed today (the real
      // signal uq_canteen_orders_token_per_day would produce); second draw
      // succeeds. See transport-bus-write.service.ts's documented shape.
      prisma.$queryRaw
        .mockRejectedValueOnce({ message: 'x', meta: { code: '23505' } })
        .mockResolvedValueOnce([
          { id: 10, pickup_token: '042', status: 'placed' },
        ]);

      const result = await service.placeOrder(7, dto);

      expect(result.order_id).toBe(10);
      expect(result.pickup_token).toBe('042');
      expect(prisma.$transaction).toHaveBeenCalledTimes(2);
      expect(wallet.refundPurchase).not.toHaveBeenCalled();
      expect(queuePush.pushKitchenUpdate).toHaveBeenCalledTimes(1);
    });

    it('falls back to the legacy sequential token when token_date is not migrated yet, without retrying forever', async () => {
      prisma.canteen_dishes.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });
      prisma.canteen_order_items = { createMany: jest.fn() };
      prisma.canteen_orders.create = jest
        .fn()
        .mockResolvedValue({ id: 20, status: 'placed' });
      prisma.canteen_orders.update = jest.fn().mockResolvedValue({
        id: 20,
        pickup_token: 'CV00020',
        status: 'placed',
      });
      // The column genuinely doesn't exist — every raw-INSERT attempt would
      // fail this way, so the service must switch strategy rather than
      // reattempt the same raw INSERT.
      prisma.$queryRaw.mockRejectedValue({
        message: 'column "token_date" does not exist',
        meta: { code: '42703' },
      });

      const result = await service.placeOrder(7, dto);

      expect(result.order_id).toBe(20);
      expect(result.pickup_token).toBe('CV00020');
      expect(prisma.canteen_orders.create).toHaveBeenCalledTimes(1);
      expect(wallet.refundPurchase).not.toHaveBeenCalled();
      expect(queuePush.pushKitchenUpdate).toHaveBeenCalledTimes(1);
    });

    it('refunds the wallet and does not retry on an unrelated DB failure', async () => {
      prisma.canteen_dishes.updateMany = jest
        .fn()
        .mockResolvedValue({ count: 1 });
      prisma.$queryRaw.mockRejectedValue(new Error('connection reset'));

      await expect(service.placeOrder(7, dto)).rejects.toThrow();

      expect(wallet.refundPurchase).toHaveBeenCalledWith(
        55,
        expect.any(String),
      );
      expect(queuePush.pushKitchenUpdate).not.toHaveBeenCalled();
    });
  });

  describe('listMyOrders', () => {
    it('scopes to today OR still-active, so an order from just before midnight survives the day boundary', async () => {
      prisma.canteen_orders.findMany.mockResolvedValue([]);

      await service.listMyOrders(7);

      expect(prisma.canteen_orders.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            placed_by_user_id: 7,
            order_source: 'self',
            OR: [
              { created_at: { gte: expect.any(Date) } },
              { status: { notIn: ['collected', 'cancelled'] } },
            ],
          }),
        }),
      );
    });
  });
});
