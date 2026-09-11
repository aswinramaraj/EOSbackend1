import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeStaffAttendanceService } from './me-staff-attendance.service';

describe('MeStaffAttendanceService', () => {
  let service: MeStaffAttendanceService;
  let prisma: {
    faculty: { findUnique: jest.Mock; findMany: jest.Mock };
    faculty_daily_attendance: { findMany: jest.Mock };
    faculty_leaves: { findMany: jest.Mock };
    faculty_holiday_mapping: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
      faculty_daily_attendance: { findMany: jest.fn().mockResolvedValue([]) },
      faculty_leaves: { findMany: jest.fn().mockResolvedValue([]) },
      faculty_holiday_mapping: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeStaffAttendanceService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeStaffAttendanceService>(MeStaffAttendanceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('falls back to non-teaching-staff attendance (keyed on staff_user_id) instead of 404ing when the JWT user has no linked faculty record', async () => {
    prisma.faculty.findUnique.mockResolvedValue(null);

    const result = await service.getMyStaffAttendance(999, {
      year: 2026,
      month: 7,
    });

    // No faculty row exists to key the query on, so it must not have asked
    // faculty_daily_attendance/faculty_leaves for one.
    for (const call of prisma.faculty_daily_attendance.findMany.mock.calls) {
      expect(call[0]?.where?.faculty_id).toBeUndefined();
    }
    expect(result.stats).toEqual(
      expect.objectContaining({ present: 0, absent: 0, onDuty: 0 }),
    );
  });

  it('returns an empty calendar with zeroed stats when there are no daily records, leaves, or holidays', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 5 });

    const result = await service.getMyStaffAttendance(1, {
      year: 2026,
      month: 7,
    });

    expect(result).toEqual({
      year: 2026,
      month: 7,
      stats: { present: 0, absent: 0, onDuty: 0, overallPercent: 100 },
      marks: {},
    });
  });

  it('marks approved-leave days as absent, clipped to the queried month, without assuming the rest of the month is present', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
    prisma.faculty_leaves.findMany.mockResolvedValue([
      {
        from_date: new Date('2026-06-29T00:00:00.000Z'),
        to_date: new Date('2026-07-02T00:00:00.000Z'),
      },
    ]);

    const result = await service.getMyStaffAttendance(1, {
      year: 2026,
      month: 7,
    });

    expect(result.marks).toEqual({
      '2026-07-01': 'absent',
      '2026-07-02': 'absent',
    });
    expect(result.stats).toEqual({
      present: 0,
      absent: 2,
      onDuty: 0,
      overallPercent: 0,
    });
  });

  it('marks opted-in holiday_slots days as holiday, without assuming the rest of the month is present', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
    prisma.faculty_leaves.findMany.mockResolvedValue([
      {
        from_date: new Date('2026-07-05T00:00:00.000Z'),
        to_date: new Date('2026-07-05T00:00:00.000Z'),
      },
    ]);
    prisma.faculty_holiday_mapping.findMany.mockResolvedValue([
      {
        holiday_slots: {
          from_date: new Date('2026-07-05T00:00:00.000Z'),
          to_date: new Date('2026-07-06T00:00:00.000Z'),
        },
      },
    ]);

    const result = await service.getMyStaffAttendance(1, {
      year: 2026,
      month: 7,
    });

    expect(result.marks).toEqual({
      '2026-07-05': 'holiday',
      '2026-07-06': 'holiday',
    });
    expect(result.stats).toEqual({
      present: 0,
      absent: 0,
      onDuty: 0,
      overallPercent: 100,
    });
  });

  it('only counts "present" for days with a real full_day/half_day faculty_daily_attendance row', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
    prisma.faculty_daily_attendance.findMany.mockResolvedValue([
      { attendance_date: new Date('2026-08-10T00:00:00.000Z'), status: 'full_day' },
    ]);

    const result = await service.getMyStaffAttendance(1, {
      year: 2026,
      month: 8,
    });

    expect(result.marks).toEqual({ '2026-08-10': 'present' });
    expect(result.stats).toEqual({
      present: 1,
      absent: 0,
      onDuty: 0,
      overallPercent: 100,
    });
  });

  it('maps faculty_daily_attendance statuses to the 4 UI states', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
    prisma.faculty_daily_attendance.findMany.mockResolvedValue([
      { attendance_date: new Date('2026-07-01T00:00:00.000Z'), status: 'full_day' },
      { attendance_date: new Date('2026-07-02T00:00:00.000Z'), status: 'half_day' },
      { attendance_date: new Date('2026-07-03T00:00:00.000Z'), status: 'absent' },
      { attendance_date: new Date('2026-07-04T00:00:00.000Z'), status: 'on_leave' },
      { attendance_date: new Date('2026-07-05T00:00:00.000Z'), status: 'on_duty' },
      { attendance_date: new Date('2026-07-06T00:00:00.000Z'), status: 'holiday' },
      { attendance_date: new Date('2026-07-07T00:00:00.000Z'), status: 'weekly_off' },
    ]);

    const result = await service.getMyStaffAttendance(1, {
      year: 2026,
      month: 7,
    });

    expect(result.marks).toEqual({
      '2026-07-01': 'present',
      '2026-07-02': 'present',
      '2026-07-03': 'absent',
      '2026-07-04': 'absent',
      '2026-07-05': 'onDuty',
      '2026-07-06': 'holiday',
      '2026-07-07': 'holiday',
    });
    expect(result.stats).toEqual({
      present: 2,
      absent: 2,
      onDuty: 1,
      // (present + onDuty) / (present + absent + onDuty) = 3/5
      overallPercent: 60,
    });
  });

  it('lets a real faculty_daily_attendance row override the leave/holiday derivation for that day', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
    prisma.faculty_leaves.findMany.mockResolvedValue([
      {
        from_date: new Date('2026-07-05T00:00:00.000Z'),
        to_date: new Date('2026-07-05T00:00:00.000Z'),
      },
    ]);
    prisma.faculty_daily_attendance.findMany.mockResolvedValue([
      { attendance_date: new Date('2026-07-05T00:00:00.000Z'), status: 'full_day' },
    ]);

    const result = await service.getMyStaffAttendance(1, {
      year: 2026,
      month: 7,
    });

    expect(result.marks['2026-07-05']).toBe('present');
  });

  it('defaults to the current year/month when none are provided', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 5 });

    const now = new Date();
    const result = await service.getMyStaffAttendance(1, {});

    expect(result.year).toBe(now.getUTCFullYear());
    expect(result.month).toBe(now.getUTCMonth() + 1);
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
    prisma.faculty_daily_attendance.findMany.mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(
      service.getMyStaffAttendance(1, { year: 2026, month: 7 }),
    ).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });

  describe('getStaffAttendanceForFacultyId', () => {
    it('throws 404 when the faculty does not exist', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(
        service.getStaffAttendanceForFacultyId(999, {}),
      ).rejects.toThrow('Faculty not found');
    });

    it('returns the same shape as the self-scoped lookup, plus the faculty record', async () => {
      const facultyRow = {
        id: 5,
        first_name: 'Deepa',
        last_name: 'Kannan',
        designation: 'Professor',
      };
      prisma.faculty.findUnique.mockResolvedValue(facultyRow);
      prisma.faculty_daily_attendance.findMany.mockResolvedValue([
        { attendance_date: new Date('2026-08-10T00:00:00.000Z'), status: 'full_day' },
      ]);

      const result = await service.getStaffAttendanceForFacultyId(5, {
        year: 2026,
        month: 8,
      });

      expect(result.faculty).toEqual(facultyRow);
      expect(result.marks).toEqual({ '2026-08-10': 'present' });
      expect(result.stats).toEqual({
        present: 1,
        absent: 0,
        onDuty: 0,
        overallPercent: 100,
      });
      expect(prisma.faculty_daily_attendance.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ faculty_id: 5 }),
        }),
      );
    });
  });

  describe('listStaffAttendanceForReview', () => {
    it('returns one row per active faculty member with that month\'s stats', async () => {
      prisma.faculty.findMany.mockResolvedValue([
        { id: 1, first_name: 'Bala', last_name: 'Murugan', designation: 'Professor' },
        { id: 2, first_name: 'Deepa', last_name: 'Kannan', designation: 'Professor' },
      ]);
      prisma.faculty_daily_attendance.findMany.mockResolvedValue([
        { faculty_id: 2, attendance_date: new Date('2026-08-10T00:00:00.000Z'), status: 'full_day' },
      ]);
      prisma.faculty_leaves.findMany.mockResolvedValue([]);
      prisma.faculty_holiday_mapping.findMany.mockResolvedValue([]);

      const result = await service.listStaffAttendanceForReview({
        year: 2026,
        month: 8,
      });

      expect(result).toEqual([
        {
          faculty: { id: 1, first_name: 'Bala', last_name: 'Murugan', designation: 'Professor' },
          year: 2026,
          month: 8,
          stats: { present: 0, absent: 0, onDuty: 0, overallPercent: 100 },
        },
        {
          faculty: { id: 2, first_name: 'Deepa', last_name: 'Kannan', designation: 'Professor' },
          year: 2026,
          month: 8,
          stats: { present: 1, absent: 0, onDuty: 0, overallPercent: 100 },
        },
      ]);
      expect(prisma.faculty.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: 'active' } }),
      );
    });

    it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
      prisma.faculty.findMany.mockRejectedValue(new Error('connection lost'));

      await expect(
        service.listStaffAttendanceForReview({ year: 2026, month: 8 }),
      ).rejects.toMatchObject({
        status: 500,
        response: { errorCode: 'INTERNAL_ERROR' },
      });
    });
  });
});
