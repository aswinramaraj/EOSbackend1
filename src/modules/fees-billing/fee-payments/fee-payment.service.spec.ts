jest.mock('../../../../generated/prisma/client', () => {
  const actual = jest.requireActual('../../../../generated/prisma/client');
  return { ...actual, PrismaClient: class {} };
});
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

const mockOrdersCreate = jest.fn();
jest.mock('razorpay', () =>
  jest.fn().mockImplementation(() => ({
    orders: { create: mockOrdersCreate },
  })),
);

import * as crypto from 'crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { Prisma } from '../../../../generated/prisma/client';
import { FeePaymentService } from './fee-payment.service';

describe('FeePaymentService', () => {
  let service: FeePaymentService;
  let notifications: { notify: jest.Mock };
  let tx: {
    student_fee_demand_mapping: { findUnique: jest.Mock };
    fee_structure_items: { findUnique: jest.Mock; findMany: jest.Mock };
    fee_payments: { aggregate: jest.Mock; create: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let prisma: {
    student_fee_demand_mapping: { findUnique: jest.Mock };
    students: { findUnique: jest.Mock };
    fee_structure_items: { findMany: jest.Mock };
    fee_payments: { aggregate: jest.Mock };
    fee_payment_gateway_orders: { create: jest.Mock; findUnique: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    process.env.RAZORPAY_KEY_ID = 'rzp_test_key';
    process.env.RAZORPAY_KEY_SECRET = 'test_secret';
    mockOrdersCreate.mockReset();

    tx = {
      student_fee_demand_mapping: { findUnique: jest.fn() },
      fee_structure_items: { findUnique: jest.fn(), findMany: jest.fn() },
      fee_payments: { aggregate: jest.fn(), create: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ max_num: 0 }]),
    };
    prisma = {
      student_fee_demand_mapping: { findUnique: jest.fn() },
      students: { findUnique: jest.fn() },
      fee_structure_items: { findMany: jest.fn() },
      fee_payments: { aggregate: jest.fn() },
      fee_payment_gateway_orders: { create: jest.fn(), findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    };
    // Both array-form ($transaction([...])) and interactive callback-form
    // ($transaction(async (tx) => ...)) are used across this service -
    // support both, matching WalletService's own spec.
    prisma.$transaction.mockImplementation((arg: unknown) => {
      if (Array.isArray(arg)) return Promise.all(arg);
      return (arg as (tx: unknown) => Promise<unknown>)(tx);
    });
    notifications = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeePaymentService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<FeePaymentService>(FeePaymentService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    beforeEach(() => {
      tx.student_fee_demand_mapping.findUnique.mockResolvedValue({ fee_structure_id: 1 });
      tx.fee_structure_items.findUnique.mockResolvedValue({
        id: 10,
        fee_structure_id: 1,
        amount: new Prisma.Decimal(1000),
      });
      tx.fee_payments.aggregate.mockResolvedValue({ _sum: { amount_paid: new Prisma.Decimal(0) } });
      tx.fee_payments.create.mockResolvedValue({
        id: 77,
        amount_paid: new Prisma.Decimal(500),
        receipt_no: 'RCP001',
      });
    });

    it('notifies the paying student once the payment is recorded', async () => {
      prisma.student_fee_demand_mapping.findUnique.mockResolvedValue({ student_id: 5 });
      prisma.students.findUnique.mockResolvedValue({ user_id: 501 });

      await service.create(
        3,
        { fee_structure_item_id: 10, amount_paid: 500, payment_mode: 'cash' } as any,
        9,
      );

      expect(prisma.student_fee_demand_mapping.findUnique).toHaveBeenCalledWith({
        where: { id: 3 },
        select: { student_id: true },
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 501,
          type: 'fee_payment_confirmed',
          related_entity_type: 'fee_payment',
          related_entity_id: 77,
        }),
      );
    });

    it('does not fail payment creation if notifying the student throws', async () => {
      prisma.student_fee_demand_mapping.findUnique.mockRejectedValue(new Error('connection lost'));

      const result = await service.create(
        3,
        { fee_structure_item_id: 10, amount_paid: 500, payment_mode: 'cash' } as any,
        9,
      );

      expect(result).toMatchObject({ id: 77 });
    });

    it('404s when the demand mapping does not exist, and never notifies', async () => {
      tx.student_fee_demand_mapping.findUnique.mockResolvedValue(null);

      await expect(
        service.create(999, { fee_structure_item_id: 10, amount_paid: 500, payment_mode: 'cash' } as any, 9),
      ).rejects.toMatchObject({ response: { errorCode: 'STUDENT_FEE_DEMAND_NOT_FOUND' } });
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('createGatewayOrder', () => {
    beforeEach(() => {
      prisma.students.findUnique.mockResolvedValue({ id: 5 });
      prisma.student_fee_demand_mapping.findUnique.mockResolvedValue({
        student_id: 5,
        fee_structure_id: 1,
      });
      prisma.fee_structure_items.findMany.mockResolvedValue([
        { amount: new Prisma.Decimal(1000) },
      ]);
      prisma.fee_payments.aggregate.mockResolvedValue({ _sum: { amount_paid: new Prisma.Decimal(200) } });
      mockOrdersCreate.mockResolvedValue({ id: 'order_fee123' });
    });

    it('stages a pending gateway order and returns the Razorpay checkout details', async () => {
      const result = await service.createGatewayOrder(1, 3, { amount: 500 } as any);

      expect(mockOrdersCreate).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 50000, currency: 'INR' }),
      );
      expect(prisma.fee_payment_gateway_orders.create).toHaveBeenCalledWith({
        data: {
          student_fee_demand_mapping_id: 3,
          amount: 500,
          status: 'pending',
          razorpay_order_id: 'order_fee123',
          created_by_user_id: 1,
        },
      });
      expect(result).toEqual({
        order_id: 'order_fee123',
        amount: 500,
        currency: 'INR',
        key_id: 'rzp_test_key',
      });
    });

    it('404s STUDENT_NOT_FOUND when the caller has no linked student record', async () => {
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(service.createGatewayOrder(1, 3, { amount: 500 } as any)).rejects.toMatchObject({
        response: { errorCode: 'STUDENT_NOT_FOUND' },
      });
      expect(mockOrdersCreate).not.toHaveBeenCalled();
    });

    it('404s STUDENT_FEE_DEMAND_NOT_FOUND when the mapping does not exist', async () => {
      prisma.student_fee_demand_mapping.findUnique.mockResolvedValue(null);

      await expect(service.createGatewayOrder(1, 999, { amount: 500 } as any)).rejects.toMatchObject({
        response: { errorCode: 'STUDENT_FEE_DEMAND_NOT_FOUND' },
      });
      expect(mockOrdersCreate).not.toHaveBeenCalled();
    });

    it("403s NOT_YOUR_DEMAND when the mapping belongs to a different student", async () => {
      prisma.student_fee_demand_mapping.findUnique.mockResolvedValue({
        student_id: 999,
        fee_structure_id: 1,
      });

      await expect(service.createGatewayOrder(1, 3, { amount: 500 } as any)).rejects.toMatchObject({
        response: { errorCode: 'NOT_YOUR_DEMAND' },
      });
      expect(mockOrdersCreate).not.toHaveBeenCalled();
    });

    it('422s AMOUNT_EXCEEDS_OUTSTANDING when the requested amount is more than the outstanding balance', async () => {
      // total 1000, already paid 200 -> outstanding 800; requesting 900.
      await expect(service.createGatewayOrder(1, 3, { amount: 900 } as any)).rejects.toMatchObject({
        response: { errorCode: 'AMOUNT_EXCEEDS_OUTSTANDING' },
      });
      expect(mockOrdersCreate).not.toHaveBeenCalled();
    });
  });

  describe('verifyGatewayPayment', () => {
    function signaturePayload(orderId: string, paymentId: string) {
      return crypto
        .createHmac('sha256', 'test_secret')
        .update(`${orderId}|${paymentId}`)
        .digest('hex');
    }

    it('404s GATEWAY_ORDER_NOT_FOUND when no order matches', async () => {
      prisma.fee_payment_gateway_orders.findUnique.mockResolvedValue(null);

      await expect(
        service.verifyGatewayPayment(1, {
          razorpay_order_id: 'order_x',
          razorpay_payment_id: 'pay_x',
          razorpay_signature: 'sig',
        } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'GATEWAY_ORDER_NOT_FOUND' } });
    });

    it("404s GATEWAY_ORDER_NOT_FOUND when the order belongs to a different caller", async () => {
      prisma.fee_payment_gateway_orders.findUnique.mockResolvedValue({
        id: 900,
        created_by_user_id: 999,
        status: 'pending',
      });

      await expect(
        service.verifyGatewayPayment(1, {
          razorpay_order_id: 'order_fee123',
          razorpay_payment_id: 'pay_x',
          razorpay_signature: 'sig',
        } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'GATEWAY_ORDER_NOT_FOUND' } });
    });

    it('400s ALREADY_PROCESSED when the order is no longer pending', async () => {
      prisma.fee_payment_gateway_orders.findUnique.mockResolvedValue({
        id: 900,
        created_by_user_id: 1,
        status: 'success',
      });

      await expect(
        service.verifyGatewayPayment(1, {
          razorpay_order_id: 'order_fee123',
          razorpay_payment_id: 'pay_x',
          razorpay_signature: 'sig',
        } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'ALREADY_PROCESSED' } });
    });

    it('marks the order failed and 400s on a signature mismatch', async () => {
      prisma.fee_payment_gateway_orders.findUnique.mockResolvedValue({
        id: 900,
        created_by_user_id: 1,
        status: 'pending',
        student_fee_demand_mapping_id: 3,
        amount: '500.00',
      });

      await expect(
        service.verifyGatewayPayment(1, {
          razorpay_order_id: 'order_fee123',
          razorpay_payment_id: 'pay_abc',
          razorpay_signature: 'not-the-real-signature',
        } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'PAYMENT_VERIFICATION_FAILED' } });

      expect(prisma.fee_payment_gateway_orders.update).toHaveBeenCalledWith({
        where: { id: 900 },
        data: {
          status: 'failed',
          razorpay_payment_id: 'pay_abc',
          razorpay_signature: 'not-the-real-signature',
        },
      });
    });

    it('records the fee payment and marks the order successful on a valid signature', async () => {
      prisma.fee_payment_gateway_orders.findUnique.mockResolvedValue({
        id: 900,
        created_by_user_id: 1,
        status: 'pending',
        student_fee_demand_mapping_id: 3,
        amount: '500.00',
      });
      tx.student_fee_demand_mapping.findUnique.mockResolvedValue({ fee_structure_id: 1 });
      tx.fee_structure_items.findMany.mockResolvedValue([{ amount: new Prisma.Decimal(1000) }]);
      tx.fee_payments.aggregate.mockResolvedValue({ _sum: { amount_paid: new Prisma.Decimal(0) } });
      tx.fee_payments.create.mockResolvedValue({
        id: 77,
        amount_paid: new Prisma.Decimal(500),
        receipt_no: 'RCP001',
      });
      prisma.students.findUnique.mockResolvedValue({ user_id: 501 });
      prisma.student_fee_demand_mapping.findUnique.mockResolvedValue({ student_id: 5 });

      const validSignature = signaturePayload('order_fee123', 'pay_abc');
      const result = await service.verifyGatewayPayment(1, {
        razorpay_order_id: 'order_fee123',
        razorpay_payment_id: 'pay_abc',
        razorpay_signature: validSignature,
      } as any);

      expect(tx.fee_payments.create).toHaveBeenCalledWith({
        data: {
          student_fee_demand_mapping_id: 3,
          fee_structure_item_id: null,
          amount_paid: 500,
          receipt_no: 'RCP001',
          payment_mode: 'razorpay',
          is_partial: true,
          collected_by_user_id: 1,
        },
      });
      expect(prisma.fee_payment_gateway_orders.update).toHaveBeenCalledWith({
        where: { id: 900 },
        data: {
          status: 'success',
          razorpay_payment_id: 'pay_abc',
          razorpay_signature: validSignature,
          fee_payment_id: 77,
        },
      });
      expect(result).toEqual({ fee_payment_id: 77, amount_paid: 500, receipt_no: 'RCP001' });
    });

    it("marks the order failed (not left pending) when the mapping's outstanding shrank below the ordered amount", async () => {
      prisma.fee_payment_gateway_orders.findUnique.mockResolvedValue({
        id: 900,
        created_by_user_id: 1,
        status: 'pending',
        student_fee_demand_mapping_id: 3,
        amount: '500.00',
      });
      tx.student_fee_demand_mapping.findUnique.mockResolvedValue({ fee_structure_id: 1 });
      tx.fee_structure_items.findMany.mockResolvedValue([{ amount: new Prisma.Decimal(1000) }]);
      // A staff payment posted in the gap - only 100 left outstanding, but 500 was ordered/charged.
      tx.fee_payments.aggregate.mockResolvedValue({ _sum: { amount_paid: new Prisma.Decimal(900) } });

      const validSignature = signaturePayload('order_fee123', 'pay_abc');

      await expect(
        service.verifyGatewayPayment(1, {
          razorpay_order_id: 'order_fee123',
          razorpay_payment_id: 'pay_abc',
          razorpay_signature: validSignature,
        } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'AMOUNT_EXCEEDS_OUTSTANDING' } });

      expect(prisma.fee_payment_gateway_orders.update).toHaveBeenCalledWith({
        where: { id: 900 },
        data: {
          status: 'failed',
          razorpay_payment_id: 'pay_abc',
          razorpay_signature: validSignature,
        },
      });
    });
  });
});
