jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';
import { MeStaffAttendanceService } from './me-staff-attendance.service';

describe('AttendanceController', () => {
  let controller: AttendanceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AttendanceController],
      providers: [
        AttendanceService,
        MeStaffAttendanceService,
        {
          provide: PrismaService,
          useValue: {
            faculty: { findUnique: jest.fn() },
            classes: { findUnique: jest.fn() },
            subjects: { findUnique: jest.fn() },
            students: { findUnique: jest.fn(), findMany: jest.fn() },
            faculty_subject_class_mapping: { findFirst: jest.fn() },
            faculty_daily_attendance: { findMany: jest.fn() },
            faculty_leaves: { findMany: jest.fn() },
            faculty_holiday_mapping: { findMany: jest.fn() },
            parent_student_mapping: {
              findMany: jest.fn(),
              findFirst: jest.fn(),
            },
            attendance_records: {
              create: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              update: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<AttendanceController>(AttendanceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
