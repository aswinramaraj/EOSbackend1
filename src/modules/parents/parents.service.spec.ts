jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeAttendanceService } from 'src/modules/admissions/students/me-profile/me-attendance.service';
import { MeExamResultsService } from 'src/modules/admissions/students/me-profile/me-exam-results.service';
import { MeFeesService } from 'src/modules/admissions/students/me-profile/me-fees.service';
import { MeAcademicCalendarService } from 'src/modules/admissions/students/me-profile/me-academic-calendar.service';
import { TimetableService } from 'src/modules/faculty/timetable/timetable.service';
import { DrivesService } from 'src/modules/placement/drives/drives.service';
import { ParentsService } from './parents.service';

describe('ParentsService', () => {
  let service: ParentsService;
  let prisma: { parent_student_mapping: { findMany: jest.Mock; findFirst: jest.Mock } };
  let meAttendanceService: { getAttendanceForStudentId: jest.Mock };
  let meExamResultsService: { getExamResultsForStudentId: jest.Mock };
  let meFeesService: { getFeesForStudentId: jest.Mock };
  let meAcademicCalendarService: { getAcademicCalendarForStudentId: jest.Mock };
  let timetableService: { getTimetableForStudentId: jest.Mock };
  let drivesService: { getUpcomingForStudentId: jest.Mock; getPlacementHistoryForStudentId: jest.Mock };

  beforeEach(async () => {
    prisma = {
      parent_student_mapping: { findMany: jest.fn(), findFirst: jest.fn() },
    };
    meAttendanceService = { getAttendanceForStudentId: jest.fn() };
    meExamResultsService = { getExamResultsForStudentId: jest.fn() };
    meFeesService = { getFeesForStudentId: jest.fn() };
    meAcademicCalendarService = { getAcademicCalendarForStudentId: jest.fn() };
    timetableService = { getTimetableForStudentId: jest.fn() };
    drivesService = { getUpcomingForStudentId: jest.fn(), getPlacementHistoryForStudentId: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: MeAttendanceService, useValue: meAttendanceService },
        { provide: MeExamResultsService, useValue: meExamResultsService },
        { provide: MeFeesService, useValue: meFeesService },
        { provide: MeAcademicCalendarService, useValue: meAcademicCalendarService },
        { provide: TimetableService, useValue: timetableService },
        { provide: DrivesService, useValue: drivesService },
      ],
    }).compile();

    service = module.get<ParentsService>(ParentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('listChildren', () => {
    it('maps each parent_student_mapping row to a child summary, resolving the name from soa_applications', async () => {
      prisma.parent_student_mapping.findMany.mockResolvedValue([
        {
          relationship: 'mother',
          students: {
            id: 5,
            student_id_no: '21CSE042',
            roll_no: '42',
            soa_applications: { first_name: 'Arun', last_name: 'Kumar' },
            users: { email: 'arun@x.com' },
            classes: {
              section: 'A',
              current_semester: 6,
              departments: { id: 1, name: 'Computer Science and Engineering', code: 'CSE' },
            },
          },
        },
      ]);

      const result = await service.listChildren(100);

      expect(prisma.parent_student_mapping.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { parent_user_id: 100 } }),
      );
      expect(result).toEqual([
        {
          id: 5,
          name: 'Arun Kumar',
          student_id_no: '21CSE042',
          roll_no: '42',
          relationship: 'mother',
          section: 'A',
          semester: 6,
          department: { id: 1, name: 'Computer Science and Engineering', code: 'CSE' },
        },
      ]);
    });

    it('falls back to email when the student has no soa_applications row', async () => {
      prisma.parent_student_mapping.findMany.mockResolvedValue([
        {
          relationship: 'father',
          students: {
            id: 6,
            student_id_no: '21CSE043',
            roll_no: null,
            soa_applications: null,
            users: { email: 'noapp@x.com' },
            classes: null,
          },
        },
      ]);

      const result = await service.listChildren(100);

      expect(result[0].name).toBe('noapp@x.com');
      expect(result[0].section).toBeNull();
      expect(result[0].department).toBeNull();
    });
  });

  describe('child-scoped access', () => {
    it('throws 403 NOT_THIS_PARENT when the caller has no mapping to that student', async () => {
      prisma.parent_student_mapping.findFirst.mockResolvedValue(null);

      await expect(
        service.getChildAttendance(100, 999, { from: '2026-08-01', to: '2026-08-31' } as any),
      ).rejects.toMatchObject({
        response: { errorCode: 'NOT_THIS_PARENT' },
      });
      expect(meAttendanceService.getAttendanceForStudentId).not.toHaveBeenCalled();
    });

    it('delegates attendance to MeAttendanceService once ownership is confirmed', async () => {
      prisma.parent_student_mapping.findFirst.mockResolvedValue({ id: 1 });
      meAttendanceService.getAttendanceForStudentId.mockResolvedValue({ overall: {}, by_subject: [], records: [] });

      await service.getChildAttendance(100, 5, { from: '2026-08-01', to: '2026-08-31' } as any);

      expect(meAttendanceService.getAttendanceForStudentId).toHaveBeenCalledWith(
        5,
        { from: '2026-08-01', to: '2026-08-31' },
      );
    });

    it('delegates performance to MeExamResultsService once ownership is confirmed', async () => {
      prisma.parent_student_mapping.findFirst.mockResolvedValue({ id: 1 });
      meExamResultsService.getExamResultsForStudentId.mockResolvedValue({ semester: 6, internals: [], semester_exam: null });

      await service.getChildPerformance(100, 5, { semester: 6 } as any);

      expect(meExamResultsService.getExamResultsForStudentId).toHaveBeenCalledWith(5, { semester: 6 });
    });

    it('delegates fees to MeFeesService once ownership is confirmed', async () => {
      prisma.parent_student_mapping.findFirst.mockResolvedValue({ id: 1 });
      meFeesService.getFeesForStudentId.mockResolvedValue({ demands: [], payments: [] });

      await service.getChildFees(100, 5);

      expect(meFeesService.getFeesForStudentId).toHaveBeenCalledWith(5);
    });

    it('delegates timetable to TimetableService once ownership is confirmed', async () => {
      prisma.parent_student_mapping.findFirst.mockResolvedValue({ id: 1 });
      timetableService.getTimetableForStudentId.mockResolvedValue({ days: [] });

      await service.getChildTimetable(100, 5, { day: 1 } as any);

      expect(timetableService.getTimetableForStudentId).toHaveBeenCalledWith(5, { day: 1 });
    });

    it('delegates academic calendar to MeAcademicCalendarService once ownership is confirmed', async () => {
      prisma.parent_student_mapping.findFirst.mockResolvedValue({ id: 1 });
      meAcademicCalendarService.getAcademicCalendarForStudentId.mockResolvedValue({
        semester: 6,
        start_date: null,
        end_date: null,
        events: [],
      });

      await service.getChildAcademicCalendar(100, 5);

      expect(meAcademicCalendarService.getAcademicCalendarForStudentId).toHaveBeenCalledWith(5);
    });

    it('delegates upcoming drives to DrivesService once ownership is confirmed', async () => {
      prisma.parent_student_mapping.findFirst.mockResolvedValue({ id: 1 });
      drivesService.getUpcomingForStudentId.mockResolvedValue([]);

      await service.getChildUpcomingDrives(100, 5);

      expect(drivesService.getUpcomingForStudentId).toHaveBeenCalledWith(5);
    });

    it('delegates placement history to DrivesService once ownership is confirmed', async () => {
      prisma.parent_student_mapping.findFirst.mockResolvedValue({ id: 1 });
      drivesService.getPlacementHistoryForStudentId.mockResolvedValue([]);

      await service.getChildPlacementHistory(100, 5);

      expect(drivesService.getPlacementHistoryForStudentId).toHaveBeenCalledWith(5);
    });
  });
});
