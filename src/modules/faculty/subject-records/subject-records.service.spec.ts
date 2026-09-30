jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { SubjectRecordsService } from './subject-records.service';

const LIVE_BANDS = [
  { grade_label: 'O', grade_point: 10, is_pass: true, display_order: 1 },
  { grade_label: 'A+', grade_point: 9, is_pass: true, display_order: 2 },
  { grade_label: 'A', grade_point: 8, is_pass: true, display_order: 3 },
  { grade_label: 'B+', grade_point: 7, is_pass: true, display_order: 4 },
  { grade_label: 'B', grade_point: 6, is_pass: true, display_order: 5 },
  { grade_label: 'RA', grade_point: 0, is_pass: false, display_order: 6 },
].map((b) => ({ ...b, min_percentage: { O: 90, 'A+': 80, A: 70, 'B+': 60, B: 50, RA: 0 }[b.grade_label] }));

describe('SubjectRecordsService', () => {
  let service: SubjectRecordsService;
  let prisma: {
    grade_bands: { findMany: jest.Mock };
    students: { findMany: jest.Mock };
    exam_marks: { findMany: jest.Mock };
    exam_subject_mapping: { findMany: jest.Mock };
  };

  const mapping = {
    id: 1,
    is_published: false,
    published_at: null,
    classes: { id: 5, section: 'A', courses: { code: 'CSE' }, batches: { name: '2023-2027' } },
    subjects: { id: 10, name: 'DBMS', subject_code: 'CS301' },
    exams: {
      id: 20,
      academic_year: '2026-27',
      semester: 3,
      start_date: new Date('2026-08-01'),
      end_date: new Date('2026-08-05'),
      exam_types: { id: 1, name: 'End Semester Examination', category: 'external' },
    },
  };

  beforeEach(async () => {
    prisma = {
      grade_bands: { findMany: jest.fn().mockResolvedValue(LIVE_BANDS) },
      students: { findMany: jest.fn().mockResolvedValue([]) },
      exam_marks: { findMany: jest.fn().mockResolvedValue([]) },
      exam_subject_mapping: { findMany: jest.fn().mockResolvedValue([mapping]) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SubjectRecordsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<SubjectRecordsService>(SubjectRecordsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAllForClass (via computeMappingDetail)', () => {
    it('reads the grading scale from the live grade_bands table, not a hardcoded array', async () => {
      prisma.exam_marks.findMany.mockResolvedValue([
        {
          marks_obtained: 92,
          max_marks: 100,
          students: { id: 1, student_id_no: 'S1', soa_applications: { first_name: 'A', last_name: 'B' }, users: { email: 'a@b.com' } },
        },
      ]);

      const [result] = await service.findAllForClass(5);

      expect(prisma.grade_bands.findMany).toHaveBeenCalledWith({ orderBy: { display_order: 'asc' } });
      // 92% -> O on the live 90/80/70/60/50/0 scale, not the old hardcoded 91/81/71/61/50/0 one.
      expect(result.grade_distribution).toEqual([
        { grade: 'O', count: 1 },
        { grade: 'A+', count: 0 },
        { grade: 'A', count: 0 },
        { grade: 'B+', count: 0 },
        { grade: 'B', count: 0 },
        { grade: 'RA', count: 0 },
      ]);
    });

    it('classifies a boundary score the old hardcoded scale would have gotten wrong (90% -> O, not A+)', async () => {
      prisma.exam_marks.findMany.mockResolvedValue([
        {
          marks_obtained: 90,
          max_marks: 100,
          students: { id: 1, student_id_no: 'S1', soa_applications: { first_name: 'A', last_name: 'B' }, users: { email: 'a@b.com' } },
        },
      ]);

      const [result] = await service.findAllForClass(5);

      const oBand = result.grade_distribution.find((g: { grade: string }) => g.grade === 'O');
      expect(oBand?.count).toBe(1);
    });
  });
});
