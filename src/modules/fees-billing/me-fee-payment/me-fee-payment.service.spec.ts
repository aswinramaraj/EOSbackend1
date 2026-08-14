// jest.requireActual keeps the real Prisma.Decimal (this service does real
// decimal arithmetic on it) — only PrismaClient itself (which would try to
// open a real DB connection) is stubbed out. Same pattern as
// fee-payment.service.spec.ts (the admin-side sibling of this service).
jest.mock('../../../../generated/prisma/client', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '../../../../generated/prisma/client',
  );
  return { ...actual, PrismaClient: class {} };
});
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

const mockOrdersCreate = jest.fn();
const mockOrdersFetch = jest.fn();
const mockPaymentsFetch = jest.fn();
jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({
    orders: { create: mockOrdersCreate, fetch: mockOrdersFetch },
    payments: { fetch: mockPaymentsFetch },
  })),
);

import { Test, TestingModule } from '@nestjs/testing';
import * as crypto from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeFeePaymentService } from './me-fee-payment.service';

function demandRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    student_id: 42,
    total_amount: 10000,
    fee_payments: [],
    ...overrides,
  };
}

describe('MeFeePaymentService', () => {
  let service: MeFeePaymentService;
  let prisma: {
    students: { findUnique: jest.Mock };
    student_fee_demand_mapping: { findUnique: jest.Mock };
    fee_structure_items: { findUnique: jest.Mock };
    fee_payments: { create: jest.Mock; findUnique: jest.Mock };
  };

  beforeEach(async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'test_secret';
    mockOrdersCreate.mockReset();
    mockOrdersFetch.mockReset();
    mockPaymentsFetch.mockReset();

    prisma = {
      students: { findUnique: jest.fn() },
      student_fee_demand_mapping: { findUnique: jest.fn() },
      fee_structure_items: { findUnique: jest.fn() },
      fee_payments: { create: jest.fn(), findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeFeePaymentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeFeePaymentService>(MeFeePaymentService);
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
  });

  describe('createOrder', () => {
    it('throws DUPLICATE_DEMAND_IN_CART for two whole-demand entries on the same demand', async () => {
      await expect(
        service.createOrder(1, {
          items: [
            { demand_id: 1, amount: 100 },
            { demand_id: 1, amount: 200 },
          ],
        }),
      ).rejects.toMatchObject({
        response: { errorCode: 'DUPLICATE_DEMAND_IN_CART' },
      });
    });

    it('allows two DIFFERENT items of the same demand in one cart (not a duplicate)', async () => {
      prisma.student_fee_demand_mapping.findUnique.mockResolvedValue(
        demandRow({ fee_structure_id: 9 }),
      );
      prisma.fee_structure_items.findUnique.mockImplementation(
        ({ where }: { where: { id: number } }) =>
          Promise.resolve({ id: where.id, amount: 5000, fee_structure_id: 9 }),
      );
      mockOrdersCreate.mockResolvedValue({ id: 'order_1' });

      await expect(
        service.createOrder(1, {
          items: [
            { demand_id: 1, amount: 3000, fee_structure_item_id: 401 },
            { demand_id: 1, amount: 2000, fee_structure_item_id: 402 },
          ],
        }),
      ).resolves.toMatchObject({ order_id: 'order_1', amount: 5000 });
    });

    it('throws ITEM_ALREADY_SETTLED when the targeted item has no outstanding due', async () => {
      prisma.student_fee_demand_mapping.findUnique.mockResolvedValue(
        demandRow({
          fee_structure_id: 9,
          fee_payments: [{ amount_paid: 5000, fee_structure_item_id: 401 }],
        }),
      );
      prisma.fee_structure_items.findUnique.mockResolvedValue({
        id: 401,
        amount: 5000,
        fee_structure_id: 9,
      });

      await expect(
        service.createOrder(1, {
          items: [{ demand_id: 1, amount: 100, fee_structure_item_id: 401 }],
        }),
      ).rejects.toMatchObject({
        response: { errorCode: 'ITEM_ALREADY_SETTLED' },
      });
    });

    it('throws AMOUNT_EXCEEDS_DUE when the amount exceeds the item outstanding due', async () => {
      prisma.student_fee_demand_mapping.findUnique.mockResolvedValue(
        demandRow({ fee_structure_id: 9 }),
      );
      prisma.fee_structure_items.findUnique.mockResolvedValue({
        id: 401,
        amount: 5000,
        fee_structure_id: 9,
      });

      await expect(
        service.createOrder(1, {
          items: [{ demand_id: 1, amount: 6000, fee_structure_item_id: 401 }],
        }),
      ).rejects.toMatchObject({
        response: { errorCode: 'AMOUNT_EXCEEDS_DUE' },
      });
    });

    it('throws FEE_STRUCTURE_ITEM_MISMATCH when the item belongs to a different fee structure', async () => {
      prisma.student_fee_demand_mapping.findUnique.mockResolvedValue(
        demandRow({ fee_structure_id: 9 }),
      );
      prisma.fee_structure_items.findUnique.mockResolvedValue({
        id: 401,
        amount: 5000,
        fee_structure_id: 999,
      });

      await expect(
        service.createOrder(1, {
          items: [{ demand_id: 1, amount: 100, fee_structure_item_id: 401 }],
        }),
      ).rejects.toMatchObject({
        response: { errorCode: 'FEE_STRUCTURE_ITEM_MISMATCH' },
      });
    });

    it('encodes fee_structure_item_ids positionally in the order notes, empty slot for whole-demand entries', async () => {
      prisma.student_fee_demand_mapping.findUnique.mockResolvedValue(
        demandRow({ id: 2, fee_structure_id: 9, total_amount: 20000 }),
      );
      prisma.fee_structure_items.findUnique.mockResolvedValue({
        id: 401,
        amount: 5000,
        fee_structure_id: 9,
      });
      mockOrdersCreate.mockResolvedValue({ id: 'order_2' });

      await service.createOrder(1, {
        items: [
          { demand_id: 1, amount: 100, fee_structure_item_id: 401 },
          { demand_id: 2, amount: 200 },
        ],
      });

      const [orderArgs] = mockOrdersCreate.mock.calls[0] as [
        { notes: Record<string, string> },
      ];
      expect(orderArgs.notes).toMatchObject({
        demand_ids: '1,2',
        amounts: '100,200',
        fee_structure_item_ids: '401,',
      });
    });
  });

  describe('verifyPayment', () => {
    function sign(orderId: string, paymentId: string) {
      return crypto
        .createHmac('sha256', 'test_secret')
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
    }

    it('rejects a bad signature', async () => {
      await expect(
        service.verifyPayment(1, {
          razorpay_order_id: 'order_x',
          razorpay_payment_id: 'pay_x',
          razorpay_signature: 'not-the-real-signature',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("rejects an order that doesn't belong to the caller", async () => {
      mockOrdersFetch.mockResolvedValue({
        notes: { student_id: '999', demand_ids: '1', amounts: '100' },
        amount: 10000,
      });

      await expect(
        service.verifyPayment(1, {
          razorpay_order_id: 'order_x',
          razorpay_payment_id: 'pay_x',
          razorpay_signature: sign('order_x', 'pay_x'),
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('records a whole-demand payment (no item id) scoped to the full demand total', async () => {
      mockOrdersFetch.mockResolvedValue({
        id: 'order_x',
        notes: { student_id: '42', demand_ids: '1', amounts: '100' },
        amount: 10000,
      });
      mockPaymentsFetch.mockResolvedValue({ method: 'upi' });
      prisma.student_fee_demand_mapping.findUnique.mockResolvedValue(
        demandRow({ total_amount: 100 }),
      );
      prisma.fee_payments.create.mockResolvedValue({
        id: 5,
        amount_paid: 100,
        receipt_no: 'RCP-ONLINE-order_x-1',
        payment_date: new Date('2026-08-13'),
      });

      await service.verifyPayment(1, {
        razorpay_order_id: 'order_x',
        razorpay_payment_id: 'pay_x',
        razorpay_signature: sign('order_x', 'pay_x'),
      });

      const [createArgs] = prisma.fee_payments.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(createArgs.data).toMatchObject({
        student_fee_demand_mapping_id: 1,
        fee_structure_item_id: undefined,
        is_partial: false, // 0 + 100 is not < 100
      });
    });

    it('records an item-scoped payment with is_partial derived from the ITEM total, not the whole demand', async () => {
      mockOrdersFetch.mockResolvedValue({
        id: 'order_y',
        notes: {
          student_id: '42',
          demand_ids: '1',
          amounts: '3000',
          fee_structure_item_ids: '401',
        },
        amount: 300000,
      });
      mockPaymentsFetch.mockResolvedValue({ method: 'card' });
      prisma.student_fee_demand_mapping.findUnique.mockResolvedValue(
        demandRow({ fee_structure_id: 9, total_amount: 10000 }),
      );
      prisma.fee_structure_items.findUnique.mockResolvedValue({
        id: 401,
        amount: 5000,
        fee_structure_id: 9,
      });
      prisma.fee_payments.create.mockResolvedValue({
        id: 6,
        amount_paid: 3000,
        receipt_no: 'RCP-ONLINE-order_y-1-401',
        payment_date: new Date('2026-08-13'),
      });

      await service.verifyPayment(1, {
        razorpay_order_id: 'order_y',
        razorpay_payment_id: 'pay_y',
        razorpay_signature: sign('order_y', 'pay_y'),
      });

      const [createArgs] = prisma.fee_payments.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];
      expect(createArgs.data).toMatchObject({
        fee_structure_item_id: 401,
        is_partial: true, // 0 + 3000 < item total 5000
        receipt_no: 'RCP-ONLINE-order_y-1-401',
      });
    });

    it('falls back to all-whole-demand when fee_structure_item_ids is absent from notes (pre-existing in-flight order)', async () => {
      mockOrdersFetch.mockResolvedValue({
        id: 'order_z',
        notes: { student_id: '42', demand_ids: '1', amounts: '100' }, // no fee_structure_item_ids key at all
        amount: 10000,
      });
      mockPaymentsFetch.mockResolvedValue({ method: 'upi' });
      prisma.student_fee_demand_mapping.findUnique.mockResolvedValue(
        demandRow({ total_amount: 100 }),
      );
      prisma.fee_payments.create.mockResolvedValue({
        id: 7,
        amount_paid: 100,
        receipt_no: 'RCP-ONLINE-order_z-1',
        payment_date: new Date('2026-08-13'),
      });

      await expect(
        service.verifyPayment(1, {
          razorpay_order_id: 'order_z',
          razorpay_payment_id: 'pay_z',
          razorpay_signature: sign('order_z', 'pay_z'),
        }),
      ).resolves.toMatchObject({ payments: [{ id: 7 }] });
      expect(prisma.fee_structure_items.findUnique).not.toHaveBeenCalled();
    });
  });
});
