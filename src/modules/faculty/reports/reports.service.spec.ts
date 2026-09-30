jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { FacultyReportsService } from './reports.service';

describe('FacultyReportsService', () => {
  let service: FacultyReportsService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    faculty_subject_class_mapping: { findMany: jest.Mock };
    students: { findMany: jest.Mock };
    attendance_records: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      faculty_subject_class_mapping: { findMany: jest.fn() },
      students: { findMany: jest.fn() },
      attendance_records: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacultyReportsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<FacultyReportsService>(FacultyReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws 404 when the caller has no faculty profile', async () => {
    prisma.faculty.findUnique.mockResolvedValue(null);

    await expect(service.getWeeklyAttendanceTrend(999)).rejects.toThrow(
      'Faculty profile not found for the authenticated user',
    );
  });

  it('returns no weeks when the faculty has no class mappings', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 1 });
    prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([]);

    const result = await service.getWeeklyAttendanceTrend(1);

    expect(result).toEqual({ weeks: [] });
    expect(prisma.students.findMany).not.toHaveBeenCalled();
  });

  it('counts on_duty as attended, not as a drag on present_percent (real gap this closes — must match AttendanceEligibilityService)', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ id: 1 });
    prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
      { class_id: 9 },
    ]);
    prisma.students.findMany.mockResolvedValue([{ id: 100 }]);
    // Monday of this week is the same "week_start" bucket for all 3 rows.
    const monday = new Date('2026-07-20T00:00:00.000Z'); // a Monday
    prisma.attendance_records.findMany.mockResolvedValue([
      { attendance_date: monday, status: 'present' },
      { attendance_date: new Date('2026-07-21T00:00:00.000Z'), status: 'on_duty' },
      { attendance_date: new Date('2026-07-22T00:00:00.000Z'), status: 'absent' },
    ]);

    const result = await service.getWeeklyAttendanceTrend(
      1,
      '2026-07-20',
      '2026-07-26',
    );

    // 2 of 3 attended (present + on_duty) — NOT 1 of 3 (present only).
    expect(result.weeks).toEqual([
      { week_start: '2026-07-20', present_percent: 66.67, marked_count: 3 },
    ]);
  });
});
