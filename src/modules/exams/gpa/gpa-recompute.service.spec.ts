jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { GpaRecomputeService } from './gpa-recompute.service';

const LIVE_BANDS = [
  { grade_label: 'O', grade_point: 10, is_pass: true, display_order: 1, min_percentage: 90 },
  { grade_label: 'A+', grade_point: 9, is_pass: true, display_order: 2, min_percentage: 80 },
  { grade_label: 'A', grade_point: 8, is_pass: true, display_order: 3, min_percentage: 70 },
  { grade_label: 'B+', grade_point: 7, is_pass: true, display_order: 4, min_percentage: 60 },
  { grade_label: 'B', grade_point: 6, is_pass: true, display_order: 5, min_percentage: 50 },
  { grade_label: 'RA', grade_point: 0, is_pass: false, display_order: 6, min_percentage: 0 },
];

describe('GpaRecomputeService', () => {
  let service: GpaRecomputeService;
  let prisma: {
    students: { findUnique: jest.Mock };
    grade_bands: { findMany: jest.Mock };
    exam_marks: { findMany: jest.Mock; findFirst: jest.Mock };
    exam_subject_mapping: { findMany: jest.Mock };
    student_semester_gpa: { findFirst: jest.Mock; upsert: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn().mockResolvedValue({ class_id: 1128 }) },
      grade_bands: { findMany: jest.fn().mockResolvedValue(LIVE_BANDS) },
      exam_marks: { findMany: jest.fn(), findFirst: jest.fn() },
      exam_subject_mapping: { findMany: jest.fn() },
      student_semester_gpa: { findFirst: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GpaRecomputeService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<GpaRecomputeService>(GpaRecomputeService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  function mockSingleSemester(opts: {
    subjects: { credits: number; percentage: number; status?: string; category?: string; isAbsent?: boolean }[];
  }) {
    const expectedMappings = opts.subjects.map((_, i) => ({ id: i + 1 }));
    prisma.exam_subject_mapping.findMany.mockResolvedValue(expectedMappings);

    // First call: distinct semesters this student has marks in.
    prisma.exam_marks.findMany.mockImplementation((args: any) => {
      if (args.distinct) {
        return Promise.resolve([
          { exam_subject_mapping: { exams: { semester: 3 } } },
        ]);
      }
      // Second call: the actual marks for computeOneSemester.
      return Promise.resolve(
        opts.subjects.map((s, i) => ({
          exam_subject_mapping_id: i + 1,
          marks_obtained: (s.percentage / 100) * 100,
          max_marks: 100,
          is_absent: s.isAbsent ?? false,
          exam_subject_mapping: {
            subjects: { credits: s.credits },
            exams: {
              status: s.status ?? 'results_published',
              exam_types: { category: s.category ?? 'external' },
            },
          },
        })),
      );
    });
  }

  it('recomputes a single, fully-published semester and persists it', async () => {
    mockSingleSemester({
      subjects: [
        { credits: 4, percentage: 90 }, // O
        { credits: 4, percentage: 80 }, // A+
      ],
    });

    await service.recomputeForStudentFrom(1, 3);

    expect(prisma.student_semester_gpa.upsert).toHaveBeenCalledTimes(1);
    const call = prisma.student_semester_gpa.upsert.mock.calls[0][0];
    expect(call.where).toEqual({ student_id_semester: { student_id: 1, semester: 3 } });
    expect(call.create).toMatchObject({
      total_credits: 8,
      total_weighted_points: 76, // 4*10 + 4*9
      sgpa: 9.5,
      cumulative_credits: 8,
      cumulative_weighted_points: 76,
      cgpa: 9.5,
      is_provisional: false,
    });
  });

  it('marks a semester provisional when fewer gradeable marks exist than real subjects offered', async () => {
    mockSingleSemester({
      subjects: [{ credits: 4, percentage: 90 }], // only 1 of 2 expected mappings gradeable
    });
    // computeOneSemester expects 2 real subject mappings for this semester, but only 1 mark exists.
    prisma.exam_subject_mapping.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await service.recomputeForStudentFrom(1, 3);

    const call = prisma.student_semester_gpa.upsert.mock.calls[0][0];
    expect(call.create.is_provisional).toBe(true);
  });

  it('excludes an internal (CIA) exam mark even when its status is results_published — the real-data bug this fixes', async () => {
    mockSingleSemester({
      subjects: [
        { credits: 4, percentage: 90, category: 'external' }, // the real end-sem grade
        { credits: 4, percentage: 40, category: 'internal' }, // a CIA that also happens to be results_published
      ],
    });

    await service.recomputeForStudentFrom(1, 3);

    const call = prisma.student_semester_gpa.upsert.mock.calls[0][0];
    // If the internal mark had wrongly counted, credits would be 8 and points would include the 40% CIA.
    expect(call.create.total_credits).toBe(4);
    expect(call.create.total_weighted_points).toBe(40); // 4 * 10 (O)
  });

  it('scores a published is_absent mark as RA/0 — counted, not excluded, and not provisional', async () => {
    mockSingleSemester({
      subjects: [
        { credits: 4, percentage: 90 }, // O
        { credits: 4, percentage: 0, isAbsent: true }, // RA — a final, known outcome once published
      ],
    });
    prisma.exam_subject_mapping.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await service.recomputeForStudentFrom(1, 3);

    const call = prisma.student_semester_gpa.upsert.mock.calls[0][0];
    // Absent counts as RA/0 points but its 4 credits still count in the denominator —
    // matching real exam-regulation convention (an arrear drags SGPA down, it isn't invisible).
    expect(call.create.total_credits).toBe(8);
    expect(call.create.total_weighted_points).toBe(40); // 4*10 (O) + 4*0 (RA)
    expect(call.create.sgpa).toBe(5); // 40/8
    expect(call.create.is_provisional).toBe(false); // both subjects have a final, known outcome
  });

  it('still treats a subject with no mark row at all (genuinely ungraded) as provisional', async () => {
    mockSingleSemester({
      subjects: [{ credits: 4, percentage: 90 }], // only 1 of 2 expected mappings has any mark row
    });
    prisma.exam_subject_mapping.findMany.mockResolvedValue([{ id: 1 }, { id: 2 }]);

    await service.recomputeForStudentFrom(1, 3);

    const call = prisma.student_semester_gpa.upsert.mock.calls[0][0];
    expect(call.create.total_credits).toBe(4);
    expect(call.create.is_provisional).toBe(true);
  });

  it('accumulates on top of a prior stored semester, not from zero', async () => {
    prisma.student_semester_gpa.findFirst.mockResolvedValue({
      semester: 2,
      cumulative_credits: 19,
      cumulative_weighted_points: 129,
    });
    mockSingleSemester({
      subjects: [{ credits: 3, percentage: 95 }], // O
    });
    prisma.exam_subject_mapping.findMany.mockResolvedValue([{ id: 1 }]);

    await service.recomputeForStudentFrom(1, 3);

    const call = prisma.student_semester_gpa.upsert.mock.calls[0][0];
    expect(call.create.cumulative_credits).toBe(22); // 19 + 3
    expect(call.create.cumulative_weighted_points).toBe(159); // 129 + 30
  });

  it('does nothing for a student with no marks at all in or after fromSemester', async () => {
    prisma.exam_marks.findMany.mockResolvedValue([]);

    await service.recomputeForStudentFrom(1, 3);

    expect(prisma.student_semester_gpa.upsert).not.toHaveBeenCalled();
  });

  it('does nothing for a student with no class assigned', async () => {
    prisma.students.findUnique.mockResolvedValue({ class_id: null });

    await service.recomputeForStudentFrom(1, 3);

    expect(prisma.student_semester_gpa.upsert).not.toHaveBeenCalled();
  });
});
