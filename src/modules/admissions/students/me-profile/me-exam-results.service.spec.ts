import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeExamResultsService } from './me-exam-results.service';

describe('MeExamResultsService', () => {
  let service: MeExamResultsService;
  let prisma: {
    students: { findUnique: jest.Mock };
    exam_marks: { findMany: jest.Mock };
    faculty_subject_class_mapping: { findFirst: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      exam_marks: { findMany: jest.fn() },
      faculty_subject_class_mapping: { findFirst: jest.fn(), findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeExamResultsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeExamResultsService>(MeExamResultsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);

    await expect(
      service.getMyExamResults(999, { semester: 5 }),
    ).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
  });

  it('scopes the query to the resolved student_id and requested semester', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.exam_marks.findMany.mockResolvedValue([]);

    await service.getMyExamResults(1, { semester: 5 });

    const [findManyArgs] = prisma.exam_marks.findMany.mock.calls[0] as [
      { where: Record<string, unknown> },
    ];
    expect(findManyArgs.where).toMatchObject({
      student_id: 42,
      exam_subject_mapping: {
        exams: { semester: 5, status: { in: ['completed', 'results_published'] } },
      },
    });
  });

  it('groups marks into internals (ordinal from the exam type name) and semester_exam', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.exam_marks.findMany.mockResolvedValue([
      {
        marks_obtained: '64',
        max_marks: '100',
        exam_subject_mapping: {
          exams: { id: 1, exam_types: { name: 'Internal Assessment 1' } },
          subjects: { id: 397, name: 'Machine Learning', subject_code: 'CS5101' },
        },
      },
      {
        marks_obtained: '75',
        max_marks: '100',
        exam_subject_mapping: {
          exams: { id: 1, exam_types: { name: 'Internal Assessment 1' } },
          subjects: { id: 398, name: 'Computer Networks', subject_code: 'CS5102' },
        },
      },
      {
        marks_obtained: '80',
        max_marks: '100',
        exam_subject_mapping: {
          exams: { id: 2, exam_types: { name: 'End Semester Examination' } },
          subjects: { id: 397, name: 'Machine Learning', subject_code: 'CS5101' },
        },
      },
    ]);

    const result = await service.getMyExamResults(1, { semester: 5 });

    expect(result.semester).toBe(5);
    expect(result.internals).toEqual([
      {
        exam_id: 1,
        number: 1,
        title: 'Internal Assessment 1',
        marks_obtained: 139,
        marks_total: 200,
        subjects: [
          { subject_id: 397, code: 'CS5101', name: 'Machine Learning', max: 100, scored: 64, faculty: null },
          { subject_id: 398, code: 'CS5102', name: 'Computer Networks', max: 100, scored: 75, faculty: null },
        ],
      },
    ]);
    expect(result.semester_exam).toEqual({
      exam_id: 2,
      // "End Semester Examination" has no trailing digit, so the ordinal
      // falls back to insertion order (this is the 2nd group created) -
      // unused by the mobile UI for this single semester_exam object, but
      // asserted here so a future refactor doesn't silently change it.
      number: 2,
      title: 'End Semester Examination',
      marks_obtained: 80,
      marks_total: 100,
      subjects: [
        { subject_id: 397, code: 'CS5101', name: 'Machine Learning', max: 100, scored: 80, faculty: null },
      ],
    });
  });

  it('attaches the assigned faculty for each subject via faculty_subject_class_mapping', async () => {
    prisma.students.findUnique
      .mockResolvedValueOnce({ id: 42 }) // getMyExamResults: resolve student by user_id
      .mockResolvedValueOnce({ class_id: 7 }); // fetchSubjectFaculty: resolve class_id by student id
    prisma.exam_marks.findMany.mockResolvedValue([
      {
        marks_obtained: '64',
        max_marks: '100',
        exam_subject_mapping: {
          exams: { id: 1, exam_types: { name: 'Internal Assessment 1' } },
          subjects: { id: 397, name: 'Machine Learning', subject_code: 'CS5101' },
        },
      },
    ]);
    prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue({
      academic_year: '2026-2027',
    });
    prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
      {
        subject_id: 397,
        faculty: { id: 12, first_name: 'Ada', last_name: 'Lovelace' },
      },
    ]);

    const result = await service.getMyExamResults(1, { semester: 5 });

    expect(prisma.faculty_subject_class_mapping.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { class_id: 7, academic_year: '2026-2027', subject_id: { in: [397] } },
      }),
    );
    expect(result.internals[0].subjects[0].faculty).toEqual({
      id: 12,
      first_name: 'Ada',
      last_name: 'Lovelace',
    });
  });

  it('treats a null marks_obtained as not-yet-scored (0) rather than throwing', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.exam_marks.findMany.mockResolvedValue([
      {
        marks_obtained: null,
        max_marks: '100',
        exam_subject_mapping: {
          exams: { id: 1, exam_types: { name: 'Internal Assessment 1' } },
          subjects: { id: 397, name: 'Machine Learning', subject_code: 'CS5101' },
        },
      },
    ]);

    const result = await service.getMyExamResults(1, { semester: 5 });

    expect(result.internals[0].marks_obtained).toBe(0);
    expect(result.internals[0].subjects[0].scored).toBe(0);
  });

  it('returns an empty internals array and null semester_exam when nothing is visible yet', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.exam_marks.findMany.mockResolvedValue([]);

    const result = await service.getMyExamResults(1, { semester: 5 });

    expect(result).toEqual({ semester: 5, internals: [], semester_exam: null });
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.exam_marks.findMany.mockRejectedValue(new Error('connection lost'));

    await expect(
      service.getMyExamResults(1, { semester: 5 }),
    ).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });
});
