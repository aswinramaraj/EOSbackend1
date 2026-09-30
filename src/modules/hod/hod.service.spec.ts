jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
  // Real Prisma.sql builds a tagged-template Sql object for $queryRaw; the
  // mocked $queryRaw below never actually parses it, it just needs
  // something to pass through — same stand-in as wallet.service.spec.ts.
  // Prisma.empty is used as a conditional-fragment placeholder in cgpaCte.
  Prisma: {
    sql: (strings: unknown, ...values: unknown[]) => ({ strings, values }),
    join: (values: unknown[]) => ({ values }),
    empty: { strings: [''], values: [] },
  },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { FacultyAttendanceService } from '../faculty/faculty-attendance/faculty-attendance.service';
import { AnnouncementsService } from '../announcements/announcements/announcements.service';
import { HodSopPopService } from './hod-sop-pop.service';
import { HodService } from './hod.service';

const hodUser: JwtPayload = { sub: 7, email: 'hod@eos.test', role: 'hod', roleId: 1 };

describe('HodService', () => {
  let service: HodService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    departments: { findUnique: jest.Mock };
    timetable_slots: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };
  let facultyAttendance: { getOverview: jest.Mock };
  let announcements: { findAll: jest.Mock };
  let sopPop: { getRequests: jest.Mock };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      departments: { findUnique: jest.fn() },
      timetable_slots: { findMany: jest.fn() },
      $queryRaw: jest.fn(),
    };
    facultyAttendance = { getOverview: jest.fn() };
    announcements = { findAll: jest.fn() };
    sopPop = { getRequests: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HodService,
        { provide: PrismaService, useValue: prisma },
        { provide: FacultyAttendanceService, useValue: facultyAttendance },
        { provide: AnnouncementsService, useValue: announcements },
        { provide: HodSopPopService, useValue: sopPop },
      ],
    }).compile();

    service = module.get<HodService>(HodService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('404s FACULTY_NOT_FOUND when the caller has no faculty row', async () => {
    prisma.faculty.findUnique.mockResolvedValue(null);

    await expect(service.getDashboard(hodUser)).rejects.toMatchObject({
      response: { errorCode: 'FACULTY_NOT_FOUND' },
    });
  });

  describe('attendance percentage (on_duty counted as attended — see attendance-percentage.util.ts)', () => {
    it('student_attendance.present/percentage come straight through from the renamed "attended" SQL field, not just present', async () => {
      prisma.faculty.findUnique.mockResolvedValue({
        id: 3,
        first_name: 'HOD',
        last_name: 'One',
        designation: 'Professor',
        department_id: 1,
      });
      prisma.departments.findUnique.mockResolvedValue({ id: 1, name: 'CSE', code: 'CSE' });
      facultyAttendance.getOverview.mockResolvedValue({
        rows: [],
        today: { attendance_percentage: 0, on_leave: 0, on_duty: 0 },
      });
      sopPop.getRequests.mockResolvedValue({ sop: [], pop: [] });
      announcements.findAll.mockResolvedValue([]);
      prisma.timetable_slots.findMany.mockResolvedValue([]);

      // 2 of 3 students attended (1 present + 1 on_duty), 1 absent — must
      // surface as 66.7%, not 33.3% (present-only).
      prisma.$queryRaw
        .mockResolvedValueOnce([{ attended: 2n, on_roll: 3n }]) // attendanceTotals
        .mockResolvedValueOnce([{ student_count: 3n, class_count: 1n }]) // countsRow
        .mockResolvedValueOnce([]) // pctRows
        .mockResolvedValueOnce([{ avg_cgpa: null }]) // cgpaRow (overall)
        .mockResolvedValueOnce([]) // recentSemesters (skips the change-vs-previous branch)
        .mockResolvedValueOnce([{ placed_count: 0n, highest_package: null, average_package: null }]) // placementRow
        .mockResolvedValueOnce([{ students_with_arrears: 0n }]) // arrearsRow
        .mockResolvedValueOnce([{ // pendingRow
          pending_leaves: 0n,
          pending_ods: 0n,
          pending_campus_outings: 0n,
          pending_student_leaves: 0n,
          pending_od_approvals: 0n,
        }]);

      const result = await service.getDashboard(hodUser, 'today');

      expect(result.student_attendance).toMatchObject({
        percentage: 66.7,
        present: 2,
        on_roll: 3,
      });
    });
  });
});
