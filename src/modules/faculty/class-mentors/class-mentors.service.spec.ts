jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { SubjectRecordsService } from 'src/modules/faculty/subject-records/subject-records.service';
import { NoDueService } from 'src/modules/faculty/no-due/no-due.service';
import { SubjectNoDueService } from 'src/modules/faculty/subject-no-due/subject-no-due.service';
import { StudentHigherEducationService } from 'src/modules/student-higher-education/student-higher-education.service';
import { StudentEntrepreneurshipService } from 'src/modules/student-entrepreneurship/student-entrepreneurship.service';
import { ClassMentorsService } from './class-mentors.service';

describe('ClassMentorsService', () => {
  let service: ClassMentorsService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    students: { findUnique: jest.Mock; findMany: jest.Mock };
    classes: { findUnique: jest.Mock };
    class_mentors: { findFirst: jest.Mock; findMany: jest.Mock };
    student_drive_applications: { findMany: jest.Mock };
    parent_student_mapping: { findFirst: jest.Mock };
    attendance_records: { findMany: jest.Mock };
    exam_marks: { findMany: jest.Mock };
    malpractice_incidents: { findMany: jest.Mock };
    sports_achievements: { findMany: jest.Mock };
    student_hostel_mapping: { findUnique: jest.Mock };
    student_scholarship_awards: { findMany: jest.Mock };
    grade_bands: { findMany: jest.Mock };
  };

  // Matches the live grade_bands table (see docs/gpa_implementation_plan.md A.3).
  const LIVE_GRADE_BANDS = [
    { grade_label: 'O', grade_point: 10, is_pass: true, min_percentage: 90 },
    { grade_label: 'A+', grade_point: 9, is_pass: true, min_percentage: 80 },
    { grade_label: 'A', grade_point: 8, is_pass: true, min_percentage: 70 },
    { grade_label: 'B+', grade_point: 7, is_pass: true, min_percentage: 60 },
    { grade_label: 'B', grade_point: 6, is_pass: true, min_percentage: 50 },
    { grade_label: 'RA', grade_point: 0, is_pass: false, min_percentage: 0 },
  ];

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      students: { findUnique: jest.fn(), findMany: jest.fn() },
      classes: { findUnique: jest.fn() },
      class_mentors: { findFirst: jest.fn(), findMany: jest.fn() },
      student_drive_applications: { findMany: jest.fn() },
      parent_student_mapping: { findFirst: jest.fn() },
      attendance_records: { findMany: jest.fn() },
      exam_marks: { findMany: jest.fn() },
      malpractice_incidents: { findMany: jest.fn() },
      sports_achievements: { findMany: jest.fn() },
      student_hostel_mapping: { findUnique: jest.fn() },
      student_scholarship_awards: { findMany: jest.fn() },
      grade_bands: { findMany: jest.fn().mockResolvedValue(LIVE_GRADE_BANDS) },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassMentorsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: SubjectRecordsService,
          useValue: { findAllForClass: jest.fn() },
        },
        {
          provide: NoDueService,
          useValue: { getStudentsForClass: jest.fn(), approveOverride: jest.fn() },
        },
        {
          provide: SubjectNoDueService,
          useValue: { getAcademicsClearedMap: jest.fn() },
        },
        {
          provide: StudentHigherEducationService,
          useValue: { findAllForClass: jest.fn() },
        },
        {
          provide: StudentEntrepreneurshipService,
          useValue: { findAllForClass: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<ClassMentorsService>(ClassMentorsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('attendance percentage — on_duty counts as attended (matches AttendanceEligibilityService, not just present)', () => {
    const attendanceRows = [
      { student_id: 1, subject_id: 14, attendance_date: new Date('2026-07-20T00:00:00.000Z'), status: 'present' },
      { student_id: 1, subject_id: 14, attendance_date: new Date('2026-07-21T00:00:00.000Z'), status: 'on_duty' },
      { student_id: 1, subject_id: 14, attendance_date: new Date('2026-07-22T00:00:00.000Z'), status: 'absent' },
    ];

    it('getMenteeClassResult: roster attendance_percent counts on_duty as attended (2/3, not 1/3)', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.class_mentors.findFirst.mockResolvedValue({
        academic_year: '2026-2027',
        faculty: { id: 5, first_name: 'Mentor', last_name: 'One' },
      });
      prisma.classes.findUnique.mockResolvedValue({
        id: 9,
        section: 'A',
        departments: { id: 1, name: 'CSE', code: 'CSE' },
        courses: { code: 'CSE' },
        batches: { name: '2026-2030' },
      });
      prisma.students.findMany.mockResolvedValue([
        {
          id: 1,
          student_id_no: '22CSE01',
          roll_no: '1',
          register_no: '22CSE01',
          soa_applications: { first_name: 'Test', last_name: 'Student' },
          users: { email: 's@eos.test' },
          student_family_details: null,
          student_contacts: null,
        },
      ]);
      prisma.attendance_records.findMany.mockResolvedValue(attendanceRows);
      prisma.exam_marks.findMany.mockResolvedValue([]);

      const result = await service.getMenteeClassResult(9, 42);

      expect(result.students[0].attendance_percent).toBe(66.67);
    });

    it('getMenteeAcademicRecord: per-subject attendance_percent and monthly_attendance both count on_duty as attended', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.students.findUnique.mockResolvedValue({ class_id: 9, status: 'active' });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.exam_marks.findMany.mockResolvedValue([
        {
          marks_obtained: 80,
          max_marks: 100,
          exam_subject_mapping: {
            subjects: { id: 14, name: 'Data Structures', subject_code: 'CS201', credits: 3 },
            exams: { semester: 3, exam_types: { name: 'End Semester' } },
          },
        },
      ]);
      prisma.attendance_records.findMany.mockResolvedValue(attendanceRows);
      prisma.malpractice_incidents.findMany.mockResolvedValue([]);
      prisma.sports_achievements.findMany.mockResolvedValue([]);
      prisma.student_hostel_mapping.findUnique.mockResolvedValue(null);
      prisma.student_scholarship_awards.findMany.mockResolvedValue([]);

      const result = await service.getMenteeAcademicRecord(1, 42);

      // All 3 records are the same month (2026-07) and subject (14).
      expect(result.monthly_attendance).toEqual([
        { month: '2026-07', present_percent: 66.67 },
      ]);
      expect(result.semesters[0].subjects[0]).toMatchObject({
        subject_id: 14,
        attendance_percent: 66.67,
      });
      // 80% -> A+ on the live grade_bands scale (min 80), not "A" as the old
      // hardcoded 91/81/71/61/50/0 array would have given it.
      expect(result.semesters[0].subjects[0].grade).toBe('A+');
    });
  });

  describe('grade lookup reads the live grade_bands table (not a hardcoded scale)', () => {
    it('getMenteeClassResult: a 90% mark grades as O and counts as a pass, not an arrear', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.class_mentors.findFirst.mockResolvedValue({
        academic_year: '2026-2027',
        faculty: { id: 5, first_name: 'Mentor', last_name: 'One' },
      });
      prisma.classes.findUnique.mockResolvedValue({
        id: 9,
        section: 'A',
        departments: { id: 1, name: 'CSE', code: 'CSE' },
        courses: { code: 'CSE' },
        batches: { name: '2026-2030' },
      });
      prisma.students.findMany.mockResolvedValue([
        {
          id: 1,
          student_id_no: '22CSE01',
          roll_no: '1',
          register_no: '22CSE01',
          soa_applications: { first_name: 'Test', last_name: 'Student' },
          users: { email: 's@eos.test' },
          student_family_details: null,
          student_contacts: null,
        },
      ]);
      prisma.attendance_records.findMany.mockResolvedValue([]);
      prisma.exam_marks.findMany.mockResolvedValue([
        {
          student_id: 1,
          marks_obtained: 90,
          max_marks: 100,
          exam_subject_mapping: {
            subjects: { credits: 4 },
            exams: { semester: 3 },
          },
        },
      ]);

      const result = await service.getMenteeClassResult(9, 42);

      // 90% is O (10 points) on the live scale — the old hardcoded scale's
      // 91% cutoff for O would have wrongly graded this A+ (9 points) and
      // it would never have been mistaken for an arrear either way, but the
      // point value itself must match the real table exactly.
      expect(result.students[0].cgpa).toBe(10);
      expect(result.students[0].arrears).toBe(0);
    });
  });
});
