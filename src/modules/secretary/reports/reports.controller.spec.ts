jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { SecretaryReportsController } from './reports.controller';
import { SecretaryReportsService } from './reports.service';

describe('SecretaryReportsController', () => {
  let controller: SecretaryReportsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SecretaryReportsController],
      providers: [
        SecretaryReportsService,
        {
          provide: PrismaService,
          useValue: {
            secretary_product_requests: { findMany: jest.fn(), count: jest.fn() },
            secretary_service_requests: { findMany: jest.fn(), count: jest.fn() },
            venue_bookings: { findMany: jest.fn(), count: jest.fn() },
            media_requests: { findMany: jest.fn(), count: jest.fn() },
            attendance_records: { findMany: jest.fn() },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<SecretaryReportsController>(
      SecretaryReportsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
