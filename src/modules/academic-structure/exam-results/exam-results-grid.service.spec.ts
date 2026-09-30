import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { ExamResultsGridService } from './exam-results-grid.service';

describe('ExamResultsGridService.buildKpis', () => {
  let service: ExamResultsGridService;
  let prisma: {
    exams: { findFirst: jest.Mock };
    students: { findUnique: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      exams: { findFirst: jest.fn().mockResolvedValue({ id: 100 }) },
      students: { findUnique: jest.fn() },
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExamResultsGridService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<ExamResultsGridService>(ExamResultsGridService);
  });

  it('counts a published-but-absent subject toward average_cgpa as RA/0 with credits included, not excluded — the same bug already fixed in GpaRecomputeService', async () => {
    // Student 1: one subject at 90% (O/10, 4 credits), one subject absent (RA/0, 4 credits).
    // Correct CGPA: (10*4 + 0*4) / (4+4) = 5. The old bug excluded the absent
    // row entirely, wrongly giving (10*4)/4 = 10.
    prisma.$queryRaw.mockResolvedValue([
      { student_id: 1, is_absent: false, is_pass: true, grade_point: '10', credits: 4 },
      { student_id: 1, is_absent: true, is_pass: null, grade_point: '0', credits: 4 },
    ]);
    prisma.students.findUnique.mockResolvedValue({
      register_no: 'U1',
      soa_applications: { first_name: 'Test', last_name: 'Student' },
    });

    const result = await service.buildKpis(1, 2, 3);

    expect(result.average_cgpa).toBe(5);
  });

  it('excludes the absent attempt from pass/fail % (attempt-based), even though it counts toward CGPA', async () => {
    prisma.$queryRaw.mockResolvedValue([
      { student_id: 1, is_absent: false, is_pass: true, grade_point: '10', credits: 4 },
      { student_id: 1, is_absent: true, is_pass: null, grade_point: '0', credits: 4 },
    ]);
    prisma.students.findUnique.mockResolvedValue({
      register_no: 'U1',
      soa_applications: { first_name: 'Test', last_name: 'Student' },
    });

    const result = await service.buildKpis(1, 2, 3);

    // Only the one graded (non-absent) attempt counts toward pass %.
    expect(result.pass_percent).toBe(100);
  });

  it('returns nulls when the exam does not exist for this class/type/semester', async () => {
    prisma.exams.findFirst.mockResolvedValue(null);

    const result = await service.buildKpis(1, 2, 3);

    expect(result).toEqual({ pass_percent: null, fail_percent: null, average_cgpa: null, topper: null });
  });
});
