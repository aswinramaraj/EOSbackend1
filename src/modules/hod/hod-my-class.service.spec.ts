jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { HodMyClassService } from './hod-my-class.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

describe('HodMyClassService', () => {
  let service: HodMyClassService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    faculty_subject_class_mapping: { findMany: jest.Mock };
    exam_subject_mapping: { findMany: jest.Mock };
    exam_marks: { findMany: jest.Mock };
    students: { findMany: jest.Mock };
    grade_bands: { findMany: jest.Mock };
  };
  const user: JwtPayload = {
    sub: 1,
    email: 'hod@eos.test',
    role: 'hod',
  } as JwtPayload;

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      faculty_subject_class_mapping: { findMany: jest.fn() },
      exam_subject_mapping: { findMany: jest.fn().mockResolvedValue([]) },
      exam_marks: { findMany: jest.fn().mockResolvedValue([]) },
      students: { findMany: jest.fn().mockResolvedValue([]) },
      grade_bands: {
        findMany: jest.fn().mockResolvedValue([
          { grade_label: 'O', grade_point: 10, is_pass: true, min_percentage: 90 },
          { grade_label: 'A+', grade_point: 9, is_pass: true, min_percentage: 80 },
          { grade_label: 'A', grade_point: 8, is_pass: true, min_percentage: 70 },
          { grade_label: 'B+', grade_point: 7, is_pass: true, min_percentage: 60 },
          { grade_label: 'B', grade_point: 6, is_pass: true, min_percentage: 50 },
          { grade_label: 'RA', grade_point: 0, is_pass: false, min_percentage: 0 },
        ]),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HodMyClassService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<HodMyClassService>(HodMyClassService);
  });

  describe('getSubjectRecords (exercises the private getHandledClasses helper)', () => {
    it('throws 404 when the JWT user has no linked faculty record', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(service.getSubjectRecords(user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns an empty handled-classes list when the HOD teaches nothing', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([]);

      const result = await service.getSubjectRecords(user);

      expect(result.handled_classes).toEqual([]);
      expect(result.selected_class).toBeNull();
    });

    it('keeps a mapping whose academic_year string sorts lower even though it is a different, still-current (subject,class) combo — the ported year-parsing fix', async () => {
      // Same real scenario TimetableService.getCurrentSemesterForFaculty's
      // own fix documents: two DIFFERENT (subject,class) combos, taught at
      // the same time, whose academic_year strings sort the "wrong" way
      // lexicographically ("2026-27" > "2026-2007" as text, even though
      // neither is actually older/newer than the other — they're just
      // different batches). The old single-global-"latest" findFirst
      // would have picked one academic_year value and silently dropped
      // every mapping under the other.
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        {
          class_id: 20,
          subject_id: 10,
          academic_year: '2026-2007', // leadingYear 2026, sorts LOWER as text than "2026-27"
          classes: {
            section: 'A',
            current_semester: 7,
            departments: { name: 'CSE' },
          },
          subjects: { name: 'Cryptography', subject_code: 'CS8792' },
        },
        {
          class_id: 21,
          subject_id: 11,
          academic_year: '2026-27',
          classes: {
            section: 'B',
            current_semester: 5,
            departments: { name: 'CSE' },
          },
          subjects: { name: 'Networks', subject_code: 'CS8551' },
        },
      ]);

      const result = await service.getSubjectRecords(user);

      expect(result.handled_classes).toEqual([
        expect.objectContaining({ class_id: 20, subject_id: 10 }),
        expect.objectContaining({ class_id: 21, subject_id: 11 }),
      ]);
    });

    it('keeps only the most recent row per (subject,class) combo when the same combo has multiple historical mapping rows', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        {
          class_id: 20,
          subject_id: 10,
          academic_year: '2022-2023',
          classes: {
            section: 'A',
            current_semester: 7,
            departments: { name: 'CSE' },
          },
          subjects: { name: 'Cryptography', subject_code: 'CS8792' },
        },
        {
          class_id: 20,
          subject_id: 10,
          academic_year: '2026-2027',
          classes: {
            section: 'A',
            current_semester: 7,
            departments: { name: 'CSE' },
          },
          subjects: { name: 'Cryptography', subject_code: 'CS8792' },
        },
      ]);

      const result = await service.getSubjectRecords(user);

      expect(result.handled_classes).toHaveLength(1);
      expect(result.handled_classes[0]).toMatchObject({
        class_id: 20,
        subject_id: 10,
      });
    });

    it('grades a student from the live grade_bands table, not a hardcoded scale (90% -> O)', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        {
          class_id: 20,
          subject_id: 10,
          academic_year: '2026-2027',
          classes: { section: 'A', current_semester: 5, departments: { name: 'CSE' } },
          subjects: { name: 'Cryptography', subject_code: 'CS8792' },
        },
      ]);
      prisma.exam_subject_mapping.findMany.mockResolvedValue([
        {
          id: 100,
          exams: { semester: 5, exam_types: { name: 'End Semester' } },
        },
      ]);
      prisma.exam_marks.findMany.mockResolvedValue([
        {
          student_id: 1,
          exam_subject_mapping_id: 100,
          marks_obtained: 90,
          max_marks: 100,
          is_absent: false,
        },
      ]);
      prisma.students.findMany.mockResolvedValue([
        {
          id: 1,
          student_id_no: '22CSE01',
          soa_applications: { first_name: 'Test', last_name: 'Student' },
          users: { email: 's@eos.test' },
        },
      ]);

      const result = await service.getSubjectRecords(user, 20, 10);

      // 90% is O (min 90) on the live scale — the old hardcoded 91/81/.../0
      // scale would have wrongly graded this A+.
      expect(result.students[0].grade).toBe('O');
    });
  });
});
