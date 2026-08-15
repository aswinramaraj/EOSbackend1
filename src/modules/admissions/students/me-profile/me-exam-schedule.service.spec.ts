import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeExamScheduleService } from './me-exam-schedule.service';

describe('MeExamScheduleService', () => {
  let service: MeExamScheduleService;
  let prisma: {
    students: { findUnique: jest.Mock };
    exam_timetable: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      exam_timetable: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeExamScheduleService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeExamScheduleService>(MeExamScheduleService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);

    await expect(service.getMyExamSchedule(999)).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
  });

  it('returns an empty list when the student has no class assigned', async () => {
    prisma.students.findUnique.mockResolvedValue({ class_id: null });

    const result = await service.getMyExamSchedule(1);

    expect(result).toEqual([]);
    expect(prisma.exam_timetable.findMany).not.toHaveBeenCalled();
  });

  it('scopes the query to the resolved class_id and only published rows', async () => {
    prisma.students.findUnique.mockResolvedValue({ class_id: 7 });
    prisma.exam_timetable.findMany.mockResolvedValue([]);

    await service.getMyExamSchedule(1);

    const [findManyArgs] = prisma.exam_timetable.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(findManyArgs.where).toMatchObject({
      exam_subject_mapping: { class_id: 7, is_published: true },
    });
  });

  it('maps composed exam/subject/exam-type names into a flat row', async () => {
    prisma.students.findUnique.mockResolvedValue({ class_id: 7 });
    prisma.exam_timetable.findMany.mockResolvedValue([
      {
        id: 5,
        exam_date: new Date('2026-08-20T00:00:00.000Z'),
        start_time: new Date('1970-01-01T09:30:00.000Z'),
        end_time: new Date('1970-01-01T12:30:00.000Z'),
        session: 'FN',
        venues: { name: 'Main Hall' },
        exam_subject_mapping: {
          subjects: { name: 'Data Structures', subject_code: 'CS201' },
          exams: {
            academic_year: '2025-2026',
            semester: 3,
            exam_types: { name: 'Internal Assessment 1' },
          },
        },
      },
    ]);

    const result = await service.getMyExamSchedule(1);

    expect(result).toEqual([
      {
        id: 5,
        exam_type: 'Internal Assessment 1',
        academic_year: '2025-2026',
        semester: 3,
        subject_name: 'Data Structures',
        subject_code: 'CS201',
        exam_date: '2026-08-20',
        start_time: '09:30',
        end_time: '12:30',
        session: 'FN',
        venue_name: 'Main Hall',
      },
    ]);
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.students.findUnique.mockResolvedValue({ class_id: 7 });
    prisma.exam_timetable.findMany.mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(service.getMyExamSchedule(1)).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });
});
