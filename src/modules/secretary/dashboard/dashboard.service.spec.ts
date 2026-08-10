jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { SecretaryDashboardService } from './dashboard.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

describe('SecretaryDashboardService', () => {
  let service: SecretaryDashboardService;

  const mockPrismaService = {
    secretary_product_requests: { count: jest.fn() },
    secretary_service_requests: { count: jest.fn() },
    venue_bookings: { count: jest.fn() },
    media_requests: { count: jest.fn() },
    faculty_daily_attendance: { findMany: jest.fn() },
    attendance_records: { findMany: jest.fn() },
    timetable_slots: { findMany: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };

  const currentUser: JwtPayload = {
    sub: 42,
    email: 'secretary@example.com',
    role: 'secretary',
    roleId: 1,
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrismaService.$transaction.mockImplementation((ops: unknown[]) =>
      Promise.all(ops),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretaryDashboardService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<SecretaryDashboardService>(SecretaryDashboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('scopes pending-request counts to the caller and sums them into a total', async () => {
    mockPrismaService.secretary_product_requests.count.mockResolvedValue(2);
    mockPrismaService.secretary_service_requests.count.mockResolvedValue(1);
    mockPrismaService.venue_bookings.count.mockResolvedValue(1);
    mockPrismaService.media_requests.count.mockResolvedValue(0);
    mockPrismaService.faculty_daily_attendance.findMany.mockResolvedValue([]);
    mockPrismaService.attendance_records.findMany.mockResolvedValue([]);
    mockPrismaService.timetable_slots.findMany.mockResolvedValue([]);

    const result = await service.summary(currentUser);

    expect(mockPrismaService.secretary_product_requests.count).toHaveBeenCalledWith({
      where: { requested_by_user_id: 42, status: 'pending' },
    });
    expect(mockPrismaService.venue_bookings.count).toHaveBeenCalledWith({
      where: { booked_by_user_id: 42, status: 'pending' },
    });
    expect(result.pending_requests).toEqual({
      product_requests: 2,
      service_requests: 1,
      venue_bookings: 1,
      media_requests: 0,
      total: 4,
    });
  });

  it('splits faculty_daily_attendance rows into on_leave/on_duty lists', async () => {
    mockPrismaService.secretary_product_requests.count.mockResolvedValue(0);
    mockPrismaService.secretary_service_requests.count.mockResolvedValue(0);
    mockPrismaService.venue_bookings.count.mockResolvedValue(0);
    mockPrismaService.media_requests.count.mockResolvedValue(0);
    mockPrismaService.faculty_daily_attendance.findMany.mockResolvedValue([
      {
        status: 'on_leave',
        faculty: {
          id: 1,
          first_name: 'K.',
          last_name: 'Muthukumar',
          designation: 'Assistant Professor',
          departments: { name: 'ECE' },
        },
      },
      {
        status: 'on_duty',
        faculty: {
          id: 2,
          first_name: 'A.',
          last_name: 'Devi',
          designation: 'Professor',
          departments: { name: 'CSE' },
        },
      },
    ]);
    mockPrismaService.attendance_records.findMany.mockResolvedValue([]);
    mockPrismaService.timetable_slots.findMany.mockResolvedValue([]);

    const result = await service.summary(currentUser);

    expect(result.faculty_today.on_leave).toBe(1);
    expect(result.faculty_today.on_duty).toBe(1);
    expect(result.faculty_today.on_leave_list).toEqual([
      { id: 1, name: 'K. Muthukumar', department: 'ECE', designation: 'Assistant Professor' },
    ]);
    expect(result.faculty_today.on_duty_list).toEqual([
      { id: 2, name: 'A. Devi', department: 'CSE', designation: 'Professor' },
    ]);
  });

  it('computes attendance completion percentage from scheduled vs marked sessions', async () => {
    mockPrismaService.secretary_product_requests.count.mockResolvedValue(0);
    mockPrismaService.secretary_service_requests.count.mockResolvedValue(0);
    mockPrismaService.venue_bookings.count.mockResolvedValue(0);
    mockPrismaService.media_requests.count.mockResolvedValue(0);
    mockPrismaService.faculty_daily_attendance.findMany.mockResolvedValue([]);
    mockPrismaService.attendance_records.findMany
      .mockResolvedValueOnce([]) // absent students
      .mockResolvedValueOnce([]) // on-duty students
      .mockResolvedValueOnce([
        { class_id: 1, subject_id: 10 },
        { class_id: 1, subject_id: 11 },
      ]); // marked sessions
    mockPrismaService.timetable_slots.findMany.mockResolvedValue([
      { class_id: 1, subject_id: 10 },
      { class_id: 1, subject_id: 11 },
      { class_id: 2, subject_id: 20 },
      { class_id: 2, subject_id: 21 },
    ]); // 4 scheduled

    const result = await service.summary(currentUser);

    expect(result.attendance_today).toEqual({
      scheduled_sessions: 4,
      marked_sessions: 2,
      completion_percentage: 50,
    });
  });

  it('returns a null completion percentage when nothing is scheduled today', async () => {
    mockPrismaService.secretary_product_requests.count.mockResolvedValue(0);
    mockPrismaService.secretary_service_requests.count.mockResolvedValue(0);
    mockPrismaService.venue_bookings.count.mockResolvedValue(0);
    mockPrismaService.media_requests.count.mockResolvedValue(0);
    mockPrismaService.faculty_daily_attendance.findMany.mockResolvedValue([]);
    mockPrismaService.attendance_records.findMany.mockResolvedValue([]);
    mockPrismaService.timetable_slots.findMany.mockResolvedValue([]);

    const result = await service.summary(currentUser);

    expect(result.attendance_today.completion_percentage).toBeNull();
  });
});
