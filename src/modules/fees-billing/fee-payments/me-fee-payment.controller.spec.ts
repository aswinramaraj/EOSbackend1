import { Test, TestingModule } from '@nestjs/testing';
import { MeFeePaymentController } from './me-fee-payment.controller';
import { FeePaymentService } from './fee-payment.service';

describe('MeFeePaymentController', () => {
  let controller: MeFeePaymentController;
  const feePaymentService = {
    createGatewayOrder: jest.fn(),
    verifyGatewayPayment: jest.fn(),
  };
  const user = { sub: 1, email: 'student@sece.ac.in', role: 'student', roleId: 6 };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeFeePaymentController],
      providers: [{ provide: FeePaymentService, useValue: feePaymentService }],
    }).compile();

    controller = module.get<MeFeePaymentController>(MeFeePaymentController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates createPaymentOrder to the service with the demand id and the caller resolved from the JWT', async () => {
    feePaymentService.createGatewayOrder.mockResolvedValue({ order_id: 'order_1' });

    await controller.createPaymentOrder(3, { amount: 500 } as any, user as any);

    expect(feePaymentService.createGatewayOrder).toHaveBeenCalledWith(1, 3, { amount: 500 });
  });

  it('delegates verifyPayment to the service with the caller resolved from the JWT', async () => {
    feePaymentService.verifyGatewayPayment.mockResolvedValue({ fee_payment_id: 77 });

    const dto = {
      razorpay_order_id: 'order_1',
      razorpay_payment_id: 'pay_1',
      razorpay_signature: 'sig',
    };
    await controller.verifyPayment(dto as any, user as any);

    expect(feePaymentService.verifyGatewayPayment).toHaveBeenCalledWith(1, dto);
  });
});
