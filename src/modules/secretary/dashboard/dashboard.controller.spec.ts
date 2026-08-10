jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { SecretaryDashboardController } from './dashboard.controller';
import { SecretaryDashboardService } from './dashboard.service';

describe('SecretaryDashboardController', () => {
  let controller: SecretaryDashboardController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SecretaryDashboardController],
      providers: [
        SecretaryDashboardService,
        {
          provide: PrismaService,
          useValue: {
            secretary_product_requests: { count: jest.fn() },
            secretary_service_requests: { count: jest.fn() },
            venue_bookings: { count: jest.fn() },
            media_requests: { count: jest.fn() },
            faculty_daily_attendance: { findMany: jest.fn() },
            attendance_records: { findMany: jest.fn() },
            timetable_slots: { findMany: jest.fn() },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<SecretaryDashboardController>(
      SecretaryDashboardController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
