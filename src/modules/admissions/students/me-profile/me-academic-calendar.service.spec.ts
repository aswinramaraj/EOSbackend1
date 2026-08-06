import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeAcademicCalendarService } from './me-academic-calendar.service';

describe('MeAcademicCalendarService', () => {
  let service: MeAcademicCalendarService;
  let prisma: {
    students: { findUnique: jest.Mock };
    classes: { findUnique: jest.Mock };
    academic_calendars: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      classes: { findUnique: jest.fn() },
      academic_calendars: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeAcademicCalendarService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeAcademicCalendarService>(MeAcademicCalendarService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);

    await expect(service.getMyAcademicCalendar(999)).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
  });

  it('returns an empty calendar when the student has no class assigned', async () => {
    prisma.students.findUnique.mockResolvedValue({ class_id: null });

    const result = await service.getMyAcademicCalendar(1);

    expect(result).toEqual({ semester: null, start_date: null, end_date: null, events: [] });
    expect(prisma.classes.findUnique).not.toHaveBeenCalled();
  });

  it('returns an empty calendar when the class has no current_semester set', async () => {
    prisma.students.findUnique.mockResolvedValue({ class_id: 22 });
    prisma.classes.findUnique.mockResolvedValue({ batch_id: 7, current_semester: null });

    const result = await service.getMyAcademicCalendar(1);

    expect(result).toEqual({ semester: null, start_date: null, end_date: null, events: [] });
    expect(prisma.academic_calendars.findUnique).not.toHaveBeenCalled();
  });

  it('returns an empty calendar (but a real semester) when no academic_calendars row exists yet', async () => {
    prisma.students.findUnique.mockResolvedValue({ class_id: 22 });
    prisma.classes.findUnique.mockResolvedValue({ batch_id: 7, current_semester: 7 });
    prisma.academic_calendars.findUnique.mockResolvedValue(null);

    const result = await service.getMyAcademicCalendar(1);

    expect(result).toEqual({ semester: 7, start_date: null, end_date: null, events: [] });
  });

  it('scopes the calendar lookup to the resolved batch_id + semester', async () => {
    prisma.students.findUnique.mockResolvedValue({ class_id: 22 });
    prisma.classes.findUnique.mockResolvedValue({ batch_id: 7, current_semester: 7 });
    prisma.academic_calendars.findUnique.mockResolvedValue(null);

    await service.getMyAcademicCalendar(1);

    expect(prisma.academic_calendars.findUnique).toHaveBeenCalledWith({
      where: { batch_id_semester: { batch_id: 7, semester: 7 } },
      select: expect.any(Object),
    });
  });

  it('maps a real calendar with events', async () => {
    prisma.students.findUnique.mockResolvedValue({ class_id: 22 });
    prisma.classes.findUnique.mockResolvedValue({ batch_id: 7, current_semester: 7 });
    prisma.academic_calendars.findUnique.mockResolvedValue({
      start_date: new Date('2026-06-01T00:00:00.000Z'),
      end_date: new Date('2026-11-30T00:00:00.000Z'),
      calendar_events: [
        {
          id: 1,
          event_date: new Date('2026-08-15T00:00:00.000Z'),
          event_type: 'holiday',
          title: 'Independence Day',
          description: null,
        },
        {
          id: 2,
          event_date: new Date('2026-08-11T00:00:00.000Z'),
          event_type: 'event',
          title: 'CIA-2 examinations begin',
          description: 'Internal assessment 2 starts',
        },
      ],
    });

    const result = await service.getMyAcademicCalendar(1);

    expect(result).toEqual({
      semester: 7,
      start_date: '2026-06-01',
      end_date: '2026-11-30',
      events: [
        {
          id: 1,
          event_date: '2026-08-15',
          event_type: 'holiday',
          title: 'Independence Day',
          description: null,
        },
        {
          id: 2,
          event_date: '2026-08-11',
          event_type: 'event',
          title: 'CIA-2 examinations begin',
          description: 'Internal assessment 2 starts',
        },
      ],
    });
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.students.findUnique.mockResolvedValue({ class_id: 22 });
    prisma.classes.findUnique.mockRejectedValue(new Error('connection lost'));

    await expect(service.getMyAcademicCalendar(1)).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });
});
