jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { TimetableService } from './timetable.service';

describe('TimetableService', () => {
  let service: TimetableService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    subjects: { findUnique: jest.Mock };
    classes: { findUnique: jest.Mock };
    students: { findUnique: jest.Mock };
    faculty_subject_class_mapping: { findFirst: jest.Mock; findMany: jest.Mock };
    timetable_slots: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    assignments: { count: jest.Mock };
    lms_notes: { count: jest.Mock };
    academic_calendars: { findUnique: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      subjects: { findUnique: jest.fn() },
      classes: { findUnique: jest.fn() },
      students: { findUnique: jest.fn() },
      faculty_subject_class_mapping: { findFirst: jest.fn(), findMany: jest.fn() },
      timetable_slots: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      assignments: { count: jest.fn() },
      lms_notes: { count: jest.fn() },
      academic_calendars: { findUnique: jest.fn() },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TimetableService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<TimetableService>(TimetableService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCurrentSemesterForFaculty', () => {
    it('throws 404 when the JWT user has no linked faculty record', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(
        service.getCurrentSemesterForFaculty(999),
      ).rejects.toThrow('Faculty profile not found for the authenticated user');
    });

    it('returns an empty subject list when the faculty has no mappings at all', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue(null);

      const result = await service.getCurrentSemesterForFaculty(1);

      expect(result).toEqual({ academic_year: null, subjects: [] });
      expect(prisma.faculty_subject_class_mapping.findMany).not.toHaveBeenCalled();
    });

    it('returns one row per subject+class combo for the latest academic_year, with real counts', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue({ academic_year: '2025-2026' });
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        {
          subject_id: 10,
          class_id: 20,
          subjects: { name: 'Cryptography', subject_code: 'CS8792' },
          classes: { section: 'A', current_semester: 7 },
        },
        {
          subject_id: 11,
          class_id: 21,
          subjects: { name: 'Networks', subject_code: 'CS8551' },
          classes: { section: 'B', current_semester: 5 },
        },
      ]);
      prisma.timetable_slots.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
      prisma.assignments.count.mockResolvedValueOnce(4).mockResolvedValueOnce(1);
      prisma.lms_notes.count.mockResolvedValueOnce(6).mockResolvedValueOnce(0);

      const result = await service.getCurrentSemesterForFaculty(1);

      expect(result).toEqual({
        academic_year: '2025-2026',
        subjects: [
          {
            subject_id: 10,
            subject_code: 'CS8792',
            subject_name: 'Cryptography',
            class_id: 20,
            section: 'A',
            semester: 7,
            hours_per_week: 3,
            tasks: 4,
            materials: 6,
          },
          {
            subject_id: 11,
            subject_code: 'CS8551',
            subject_name: 'Networks',
            class_id: 21,
            section: 'B',
            semester: 5,
            hours_per_week: 2,
            tasks: 1,
            materials: 0,
          },
        ],
      });
      expect(prisma.faculty_subject_class_mapping.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { faculty_id: 5, academic_year: '2025-2026' } }),
      );
    });
  });

  describe('findFullWeekForFaculty', () => {
    it('throws 404 when the JWT user has no linked faculty record', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(
        service.findFullWeekForFaculty(999),
      ).rejects.toThrow('Faculty profile not found for the authenticated user');
    });

    it('groups the faculty\'s own slots by day_of_week across the whole week', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.timetable_slots.findMany.mockResolvedValue([
        {
          day_of_week: 1,
          period_number: 1,
          start_time: new Date('1970-01-01T09:00:00.000Z'),
          end_time: new Date('1970-01-01T09:50:00.000Z'),
          subjects: { id: 1, name: 'Cryptography', subject_code: 'CS8792' },
          faculty: { id: 5, first_name: 'Deepa', last_name: 'Kannan' },
        },
        {
          day_of_week: 1,
          period_number: 2,
          start_time: new Date('1970-01-01T09:50:00.000Z'),
          end_time: new Date('1970-01-01T10:40:00.000Z'),
          subjects: { id: 2, name: 'Networks', subject_code: 'CS8551' },
          faculty: { id: 5, first_name: 'Deepa', last_name: 'Kannan' },
        },
        {
          day_of_week: 3,
          period_number: 1,
          start_time: new Date('1970-01-01T09:00:00.000Z'),
          end_time: new Date('1970-01-01T09:50:00.000Z'),
          subjects: { id: 1, name: 'Cryptography', subject_code: 'CS8792' },
          faculty: { id: 5, first_name: 'Deepa', last_name: 'Kannan' },
        },
      ]);

      const result = await service.findFullWeekForFaculty(1);

      expect(result).toEqual({
        days: [
          {
            day_of_week: 1,
            slots: [
              {
                period_number: 1,
                start_time: '09:00',
                end_time: '09:50',
                subject: { id: 1, name: 'Cryptography', subject_code: 'CS8792' },
                faculty: { id: 5, name: 'Deepa Kannan' },
              },
              {
                period_number: 2,
                start_time: '09:50',
                end_time: '10:40',
                subject: { id: 2, name: 'Networks', subject_code: 'CS8551' },
                faculty: { id: 5, name: 'Deepa Kannan' },
              },
            ],
          },
          {
            day_of_week: 3,
            slots: [
              {
                period_number: 1,
                start_time: '09:00',
                end_time: '09:50',
                subject: { id: 1, name: 'Cryptography', subject_code: 'CS8792' },
                faculty: { id: 5, name: 'Deepa Kannan' },
              },
            ],
          },
        ],
      });
      expect(prisma.timetable_slots.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { faculty_id: 5 } }),
      );
    });

    it('returns an empty days array when the faculty has no timetable slots', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.timetable_slots.findMany.mockResolvedValue([]);

      const result = await service.findFullWeekForFaculty(1);

      expect(result).toEqual({ days: [] });
    });
  });

  describe('getMergedAcademicCalendarForFaculty', () => {
    const empty = { semester: null, start_date: null, end_date: null, events: [] };

    it('throws 404 when the JWT user has no linked faculty record', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(
        service.getMergedAcademicCalendarForFaculty(999),
      ).rejects.toThrow('Faculty profile not found for the authenticated user');
    });

    it('returns an empty calendar when the faculty has no mappings at all', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue(null);

      const result = await service.getMergedAcademicCalendarForFaculty(1);

      expect(result).toEqual(empty);
      expect(prisma.faculty_subject_class_mapping.findMany).not.toHaveBeenCalled();
    });

    it('returns an empty calendar when none of the taught classes have a current_semester set', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue({ academic_year: '2025-2026' });
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        { classes: { batch_id: 1, current_semester: null } },
      ]);

      const result = await service.getMergedAcademicCalendarForFaculty(1);

      expect(result).toEqual(empty);
      expect(prisma.academic_calendars.findUnique).not.toHaveBeenCalled();
    });

    it('returns a single semester number when every resolved calendar shares it', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue({ academic_year: '2025-2026' });
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        { classes: { batch_id: 1, current_semester: 3 } },
        { classes: { batch_id: 1, current_semester: 3 } },
      ]);
      prisma.academic_calendars.findUnique.mockResolvedValue({
        semester: 3,
        start_date: new Date('2026-06-01T00:00:00.000Z'),
        end_date: new Date('2026-11-30T00:00:00.000Z'),
        calendar_events: [
          { id: 1, event_date: new Date('2026-08-15T00:00:00.000Z'), event_type: 'holiday', title: 'Independence Day', description: null },
        ],
      });

      const result = await service.getMergedAcademicCalendarForFaculty(1);

      expect(result).toEqual({
        semester: 3,
        start_date: '2026-06-01',
        end_date: '2026-11-30',
        events: [
          { id: 1, event_date: '2026-08-15', event_type: 'holiday', title: 'Independence Day', description: null },
        ],
      });
      expect(prisma.academic_calendars.findUnique).toHaveBeenCalledTimes(1);
    });

    it('merges events from multiple distinct (batch, semester) calendars, dedupes shared holidays, and unions the date range', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue({ academic_year: '2025-2026' });
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        { classes: { batch_id: 1, current_semester: 3 } },
        { classes: { batch_id: 2, current_semester: 5 } },
      ]);
      prisma.academic_calendars.findUnique
        .mockResolvedValueOnce({
          semester: 3,
          start_date: new Date('2026-06-01T00:00:00.000Z'),
          end_date: new Date('2026-11-30T00:00:00.000Z'),
          calendar_events: [
            { id: 1, event_date: new Date('2026-08-15T00:00:00.000Z'), event_type: 'holiday', title: 'Independence Day', description: null },
          ],
        })
        .mockResolvedValueOnce({
          semester: 5,
          start_date: new Date('2026-05-01T00:00:00.000Z'),
          end_date: new Date('2026-12-15T00:00:00.000Z'),
          calendar_events: [
            // Same institution-wide holiday, appears on this batch's calendar too - deduped.
            { id: 2, event_date: new Date('2026-08-15T00:00:00.000Z'), event_type: 'holiday', title: 'Independence Day', description: null },
            { id: 3, event_date: new Date('2026-09-05T00:00:00.000Z'), event_type: 'event', title: "Teachers' Day", description: null },
          ],
        });

      const result = await service.getMergedAcademicCalendarForFaculty(1);

      expect(result.semester).toBeNull();
      expect(result.start_date).toBe('2026-05-01');
      expect(result.end_date).toBe('2026-12-15');
      expect(result.events).toEqual([
        { id: 1, event_date: '2026-08-15', event_type: 'holiday', title: 'Independence Day', description: null },
        { id: 3, event_date: '2026-09-05', event_type: 'event', title: "Teachers' Day", description: null },
      ]);
    });
  });
});
