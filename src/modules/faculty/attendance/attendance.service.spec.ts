jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { AttendanceService } from './attendance.service';

describe('AttendanceService', () => {
  let service: AttendanceService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    classes: { findUnique: jest.Mock };
    subjects: { findUnique: jest.Mock };
    students: { findUnique: jest.Mock; findMany: jest.Mock };
    faculty_subject_class_mapping: { findFirst: jest.Mock };
    parent_student_mapping: { findMany: jest.Mock; findFirst: jest.Mock };
    attendance_records: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
    $executeRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      classes: { findUnique: jest.fn() },
      subjects: { findUnique: jest.fn() },
      students: { findUnique: jest.fn(), findMany: jest.fn() },
      faculty_subject_class_mapping: { findFirst: jest.fn() },
      parent_student_mapping: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
      },
      attendance_records: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
      $executeRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [AttendanceService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<AttendanceService>(AttendanceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // Regression coverage for a real bug: attendance_records.marked_by_user_id
  // is a required (non-nullable) column, but neither create() nor
  // markForClass() ever set it - every real call 500'd with a
  // PrismaClientValidationError the moment it reached a live database
  // (mocked $transaction/create here never validate required columns, which
  // is exactly why this went unnoticed until a live "Save Attendance" call
  // from the mobile app surfaced it).
  describe('create', () => {
    it('sets marked_by_user_id (not just marked_by_faculty_id) on every created row', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.classes.findUnique.mockResolvedValue({
        id: 5,
        section: 'A',
        departments: { id: 1, name: 'CSE', code: 'CSE' },
      });
      prisma.students.findMany.mockResolvedValue([{ id: 121, class_id: 5 }]);

      const tx = {
        $executeRaw: jest.fn().mockResolvedValue(undefined),
        attendance_records: {
          findMany: jest.fn().mockResolvedValue([]),
          create: jest.fn().mockResolvedValue({ id: 1, student_id: 121, status: 'present' }),
        },
      };
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) => cb(tx));

      await service.create(
        {
          class_id: 5,
          date: '2026-08-08',
          records: [{ student_id: 121, status: 'present' }],
        },
        42,
        ROLES.FACULTY,
      );

      expect(tx.attendance_records.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            marked_by_faculty_id: 9,
            marked_by_user_id: 42,
          }),
        }),
      );
    });
  });

  describe('markForClass', () => {
    it('sets marked_by_user_id (not just marked_by_faculty_id) on every created row', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.classes.findUnique.mockResolvedValue({ id: 5 });
      prisma.subjects.findUnique.mockResolvedValue({ id: 75 });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue({ id: 1 });
      prisma.students.findMany.mockResolvedValue([{ id: 121, class_id: 5 }]);
      prisma.attendance_records.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((calls: Promise<unknown>[]) => Promise.all(calls));
      prisma.attendance_records.create.mockResolvedValue({ id: 1 });

      await service.markForClass(
        5,
        {
          subject_id: 75,
          attendance_date: '2026-08-08',
          records: [{ student_id: 121, status: 'present' }],
        },
        42,
      );

      expect(prisma.attendance_records.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            marked_by_faculty_id: 9,
            marked_by_user_id: 42,
          }),
        }),
      );
    });

    it('attaches photo_url (from a prior recognize call) to every created row when given', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.classes.findUnique.mockResolvedValue({ id: 5 });
      prisma.subjects.findUnique.mockResolvedValue({ id: 75 });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue({ id: 1 });
      prisma.students.findMany.mockResolvedValue([{ id: 121, class_id: 5 }]);
      prisma.attendance_records.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((calls: Promise<unknown>[]) => Promise.all(calls));
      prisma.attendance_records.create.mockResolvedValue({ id: 1 });

      await service.markForClass(
        5,
        {
          subject_id: 75,
          attendance_date: '2026-08-08',
          photo_url: 'https://res.cloudinary.com/demo/image/upload/attendance/class-5.jpg',
          records: [{ student_id: 121, status: 'present' }],
        },
        42,
      );

      expect(prisma.attendance_records.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            photo_url: 'https://res.cloudinary.com/demo/image/upload/attendance/class-5.jpg',
          }),
        }),
      );
    });

    it('leaves photo_url unset for a fully manual marking (no prior recognize call)', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9 });
      prisma.classes.findUnique.mockResolvedValue({ id: 5 });
      prisma.subjects.findUnique.mockResolvedValue({ id: 75 });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue({ id: 1 });
      prisma.students.findMany.mockResolvedValue([{ id: 121, class_id: 5 }]);
      prisma.attendance_records.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation((calls: Promise<unknown>[]) => Promise.all(calls));
      prisma.attendance_records.create.mockResolvedValue({ id: 1 });

      await service.markForClass(
        5,
        { subject_id: 75, attendance_date: '2026-08-08', records: [{ student_id: 121, status: 'present' }] },
        42,
      );

      const [[call]] = prisma.attendance_records.create.mock.calls;
      expect(call.data.photo_url).toBeUndefined();
    });
  });
});
