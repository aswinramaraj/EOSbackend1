import { Test, TestingModule } from '@nestjs/testing';
import { CanteenQueueService } from './canteen-queue.service';
import { PrismaService } from 'src/prisma/prisma.service';

jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('CanteenQueueService', () => {
  let service: CanteenQueueService;
  let prisma: any;

  beforeEach(async () => {
    prisma = {
      canteen_orders: { findMany: jest.fn(), count: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CanteenQueueService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<CanteenQueueService>(CanteenQueueService);
  });

  describe('getKitchenQueue', () => {
    it('queries only not-yet-ready self orders, oldest first, capped at 6, and never selects orderer identity', async () => {
      prisma.canteen_orders.findMany.mockResolvedValue([]);
      prisma.canteen_orders.count.mockResolvedValue(0);

      await service.getKitchenQueue();

      const call = prisma.canteen_orders.findMany.mock.calls[0][0];
      expect(call.where).toEqual({
        order_source: 'self',
        status: { in: ['placed'] },
      });
      expect(call.orderBy).toEqual({ created_at: 'asc' });
      expect(call.take).toBe(6);
      expect(JSON.stringify(call.include ?? call.select)).not.toMatch(
        /placed_by_user_id|users/,
      );
    });

    it('reports totalActive separately from the visible (capped) list, for the "+N more waiting" note', async () => {
      const orders = Array.from({ length: 6 }, (_, i) => ({
        id: i,
        pickup_token: `00${i}`,
        status: 'placed',
        created_at: new Date(),
        canteen_order_items: [],
      }));
      prisma.canteen_orders.findMany.mockResolvedValue(orders);
      prisma.canteen_orders.count.mockResolvedValue(9);

      const result = await service.getKitchenQueue();

      expect(result.orders).toHaveLength(6);
      expect(result.totalActive).toBe(9);
    });
  });

  describe('getCounterQueue', () => {
    it('queries only ready self orders, oldest-ready-first, with no item/dish detail in the returned shape', async () => {
      prisma.canteen_orders.findMany.mockResolvedValue([
        { id: 1, pickup_token: '042', updated_at: new Date() },
      ]);

      const result = await service.getCounterQueue();

      const call = prisma.canteen_orders.findMany.mock.calls[0][0];
      expect(call.where).toEqual({ order_source: 'self', status: 'ready' });
      expect(call.orderBy).toEqual({ updated_at: 'asc' });
      expect(result.orders[0]).toEqual({
        orderId: 1,
        token: '042',
        readySince: expect.any(String),
      });
      expect(result.orders[0]).not.toHaveProperty('items');
    });
  });
});
