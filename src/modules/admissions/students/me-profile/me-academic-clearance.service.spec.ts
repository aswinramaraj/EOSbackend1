jest.mock('../../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeAcademicClearanceService } from './me-academic-clearance.service';

const STUDENT = { id: 1, class_id: 10 };
const CLASS = { batch_id: 4, current_semester: 5 };

describe('MeAcademicClearanceService', () => {
  let service: MeAcademicClearanceService;
  let prisma: {
    students: { findUnique: jest.Mock };
    classes: { findUnique: jest.Mock };
    class_subjects: { findMany: jest.Mock };
    assignments: { findMany: jest.Mock };
    academic_calendars: { findUnique: jest.Mock };
    attendance_records: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      classes: { findUnique: jest.fn() },
      class_subjects: { findMany: jest.fn() },
      assignments: { findMany: jest.fn() },
      academic_calendars: { findUnique: jest.fn() },
      attendance_records: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MeAcademicClearanceService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<MeAcademicClearanceService>(MeAcademicClearanceService);
  });

  it('throws NOT_FOUND when the caller has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);
    await expect(service.getMyAcademicClearance(100, {})).rejects.toThrow(NotFoundException);
  });

  it('returns an empty subject list when the student has no class assigned', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 1, class_id: null });
    const result = await service.getMyAcademicClearance(100, {});
    expect(result).toEqual({ semester: null, subjects: [] });
  });

  it('returns an empty subject list when the class has no subjects for that semester', async () => {
    prisma.students.findUnique.mockResolvedValue(STUDENT);
    prisma.classes.findUnique.mockResolvedValue(CLASS);
    prisma.class_subjects.findMany.mockResolvedValue([]);

    const result = await service.getMyAcademicClearance(100, { semester: 3 });
    expect(result).toEqual({ semester: 3, subjects: [] });
  });

  it('defaults to the class current_semester when none is supplied', async () => {
    prisma.students.findUnique.mockResolvedValue(STUDENT);
    prisma.classes.findUnique.mockResolvedValue(CLASS);
    prisma.class_subjects.findMany.mockResolvedValue([]);

    const result = await service.getMyAcademicClearance(100, {});
    expect(result.semester).toBe(5);
  });

  it('returns attendance_percentage: null (not fabricated) when no academic_calendars row exists for the semester', async () => {
    prisma.students.findUnique.mockResolvedValue(STUDENT);
    prisma.classes.findUnique.mockResolvedValue(CLASS);
    prisma.class_subjects.findMany.mockResolvedValue([
      { subject_id: 1, subjects: { id: 1, name: 'Machine Learning', subject_code: 'CS3491' } },
    ]);
    prisma.assignments.findMany.mockResolvedValue([]);
    prisma.academic_calendars.findUnique.mockResolvedValue(null);

    const result = await service.getMyAcademicClearance(100, { semester: 5 });

    expect(prisma.attendance_records.findMany).not.toHaveBeenCalled();
    expect(result.subjects[0]).toMatchObject({
      subject_id: 1,
      attendance_percentage: null,
      attendance_cleared: false,
      all_assignments_submitted: true, // vacuously true — zero assignments
      cleared: false, // attendance not cleared, so overall not cleared
    });
  });

  it('groups assignments per subject and computes is_submitted / all_assignments_submitted / cleared correctly', async () => {
    prisma.students.findUnique.mockResolvedValue(STUDENT);
    prisma.classes.findUnique.mockResolvedValue(CLASS);
    prisma.class_subjects.findMany.mockResolvedValue([
      { subject_id: 1, subjects: { id: 1, name: 'Machine Learning', subject_code: 'CS3491' } },
      { subject_id: 2, subjects: { id: 2, name: 'Cryptography', subject_code: 'CB3491' } },
    ]);
    prisma.assignments.findMany.mockResolvedValue([
      {
        id: 101,
        title: 'Assignment 1',
        sequence_no: 1,
        subject_id: 1,
        student_assignment_status: [{ is_submitted: true }],
      },
      {
        id: 102,
        title: 'Assignment 2',
        sequence_no: 2,
        subject_id: 1,
        student_assignment_status: [{ is_submitted: false }],
      },
      {
        id: 201,
        title: 'Assignment 1',
        sequence_no: 1,
        subject_id: 2,
        student_assignment_status: [{ is_submitted: true }],
      },
    ]);
    prisma.academic_calendars.findUnique.mockResolvedValue({
      start_date: new Date('2026-07-01'),
      end_date: new Date('2026-11-30'),
    });
    // Subject 1: 8 present / 10 total = 80% (>= 75 threshold => cleared).
    // Subject 2: 5 present / 10 total = 50% (< 75 threshold => not cleared).
    const records = [
      ...Array.from({ length: 8 }, () => ({ subject_id: 1, status: 'present' })),
      ...Array.from({ length: 2 }, () => ({ subject_id: 1, status: 'absent' })),
      ...Array.from({ length: 5 }, () => ({ subject_id: 2, status: 'present' })),
      ...Array.from({ length: 5 }, () => ({ subject_id: 2, status: 'absent' })),
    ];
    prisma.attendance_records.findMany.mockResolvedValue(records);

    const result = await service.getMyAcademicClearance(100, { semester: 5 });

    const subj1 = result.subjects.find((s) => s.subject_id === 1);
    const subj2 = result.subjects.find((s) => s.subject_id === 2);

    expect(subj1.assignments).toEqual([
      { id: 101, title: 'Assignment 1', sequence_no: 1, is_submitted: true },
      { id: 102, title: 'Assignment 2', sequence_no: 2, is_submitted: false },
    ]);
    expect(subj1.all_assignments_submitted).toBe(false);
    expect(subj1.attendance_percentage).toBe(80);
    expect(subj1.attendance_cleared).toBe(true);
    expect(subj1.cleared).toBe(false); // assignments not all submitted

    expect(subj2.all_assignments_submitted).toBe(true);
    expect(subj2.attendance_percentage).toBe(50);
    expect(subj2.attendance_cleared).toBe(false);
    expect(subj2.cleared).toBe(false); // attendance below threshold
  });

  it('marks a subject fully cleared only when both assignments and attendance are satisfied', async () => {
    prisma.students.findUnique.mockResolvedValue(STUDENT);
    prisma.classes.findUnique.mockResolvedValue(CLASS);
    prisma.class_subjects.findMany.mockResolvedValue([
      { subject_id: 1, subjects: { id: 1, name: 'Machine Learning', subject_code: 'CS3491' } },
    ]);
    prisma.assignments.findMany.mockResolvedValue([
      {
        id: 101,
        title: 'Assignment 1',
        sequence_no: 1,
        subject_id: 1,
        student_assignment_status: [{ is_submitted: true }],
      },
    ]);
    prisma.academic_calendars.findUnique.mockResolvedValue({
      start_date: new Date('2026-07-01'),
      end_date: new Date('2026-11-30'),
    });
    prisma.attendance_records.findMany.mockResolvedValue(
      Array.from({ length: 10 }, () => ({ subject_id: 1, status: 'present' })),
    );

    const result = await service.getMyAcademicClearance(100, { semester: 5 });

    expect(result.subjects[0]).toMatchObject({
      all_assignments_submitted: true,
      attendance_percentage: 100,
      attendance_cleared: true,
      cleared: true,
    });
  });
});
