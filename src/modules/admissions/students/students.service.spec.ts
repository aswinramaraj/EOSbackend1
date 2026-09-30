jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
  address_type_enum: { permanent: 'permanent', temporary: 'temporary' },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { NotificationsService } from '../../notifications/notifications/notifications.service';
import { StudentsService } from './students.service';

function studentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    student_id_no: '22IT101',
    roll_no: '1',
    register_no: '22IT101',
    admission_no: 'A1',
    gender: 'male',
    date_of_birth: null,
    student_type: 'dayscholar',
    dayscholar_mode: null,
    status: 'active',
    admission_date: null,
    created_at: new Date('2026-01-01'),
    photo_url: null,
    photo_uploaded_at: null,
    batches: { id: 1, name: '2026-2030' },
    classes: { id: 5, section: 'A', current_semester: 3 },
    courses: { id: 1, name: 'CSE', code: 'CSE', departments: { id: 1, name: 'CSE' } },
    quotas: null,
    users: { id: 100, email: 's@eos.test', phone: null, status: 'active' },
    soa_applications: { first_name: 'Test', last_name: 'Student' },
    student_contacts: null,
    ...overrides,
  };
}

describe('StudentsService', () => {
  let service: StudentsService;
  let prisma: {
    students: { findUnique: jest.Mock; count: jest.Mock };
    classes: { findUnique: jest.Mock };
    courses: { findUnique: jest.Mock };
    quotas: { findUnique: jest.Mock };
    batches: { findUnique: jest.Mock };
    subjects: { findUnique: jest.Mock };
    attendance_records: { findMany: jest.Mock; groupBy: jest.Mock };
    academic_calendars: { findMany: jest.Mock };
    timetable_slots: { findMany: jest.Mock };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn(), count: jest.fn() },
      classes: { findUnique: jest.fn() },
      courses: { findUnique: jest.fn() },
      quotas: { findUnique: jest.fn() },
      batches: { findUnique: jest.fn() },
      subjects: { findUnique: jest.fn() },
      attendance_records: { findMany: jest.fn(), groupBy: jest.fn() },
      academic_calendars: { findMany: jest.fn() },
      timetable_slots: { findMany: jest.fn() },
      $transaction: jest.fn(),
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn() } },
      ],
    }).compile();

    service = module.get<StudentsService>(StudentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('update — section capacity', () => {
    it('409s with SECTION_FULL when the target class is already at capacity', async () => {
      prisma.students.findUnique.mockResolvedValue(studentRow({ classes: { id: 5, section: 'A', current_semester: 3 } }));
      prisma.$queryRaw.mockResolvedValue([{ capacity: 60 }]);
      prisma.students.count.mockResolvedValue(60);

      await expect(
        service.update(1, { class_id: 9 } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'SECTION_FULL' } });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows the move when the target class has room', async () => {
      prisma.students.findUnique.mockResolvedValue(studentRow({ classes: { id: 5, section: 'A', current_semester: 3 } }));
      prisma.$queryRaw.mockResolvedValue([{ capacity: 60 }]);
      prisma.students.count.mockResolvedValue(59);
      prisma.classes.findUnique.mockResolvedValue({ id: 9 });
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
        cb({ students: { update: jest.fn().mockResolvedValue({ id: 1, user_id: 100, soa_application_id: 1 }) }, users: { update: jest.fn() } }),
      );

      await service.update(1, { class_id: 9 } as any);

      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('does not check capacity when class_id is unchanged from the student\'s current class', async () => {
      prisma.students.findUnique.mockResolvedValue(studentRow({ classes: { id: 5, section: 'A', current_semester: 3 } }));
      prisma.classes.findUnique.mockResolvedValue({ id: 5 });
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
        cb({ students: { update: jest.fn().mockResolvedValue({ id: 1, user_id: 100, soa_application_id: 1 }) }, users: { update: jest.fn() } }),
      );

      await service.update(1, { class_id: 5, roll_no: '2' } as any);

      expect(prisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('allows the move when capacity is not set (unlimited)', async () => {
      prisma.students.findUnique.mockResolvedValue(studentRow({ classes: { id: 5, section: 'A', current_semester: 3 } }));
      prisma.$queryRaw.mockResolvedValue([{ capacity: null }]);
      prisma.classes.findUnique.mockResolvedValue({ id: 9 });
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
        cb({ students: { update: jest.fn().mockResolvedValue({ id: 1, user_id: 100, soa_application_id: 1 }) }, users: { update: jest.fn() } }),
      );

      await service.update(1, { class_id: 9 } as any);

      expect(prisma.students.count).not.toHaveBeenCalled();
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('degrades to unlimited when the capacity column does not exist yet (pre-migration)', async () => {
      prisma.students.findUnique.mockResolvedValue(studentRow({ classes: { id: 5, section: 'A', current_semester: 3 } }));
      prisma.$queryRaw.mockRejectedValue({
        code: 'P2010',
        meta: { code: '42703', message: 'column "capacity" does not exist' },
      });
      prisma.classes.findUnique.mockResolvedValue({ id: 9 });
      prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
        cb({ students: { update: jest.fn().mockResolvedValue({ id: 1, user_id: 100, soa_application_id: 1 }) }, users: { update: jest.fn() } }),
      );

      await expect(service.update(1, { class_id: 9 } as any)).resolves.toBeDefined();
      expect(prisma.$transaction).toHaveBeenCalled();
    });
  });

  describe('attendance percentage — on_duty counts as attended (matches AttendanceEligibilityService, not just present)', () => {
    const records = [
      { attendance_date: new Date('2026-07-20T00:00:00.000Z'), subject_id: 14, status: 'present', subjects: { name: 'DS' } },
      { attendance_date: new Date('2026-07-21T00:00:00.000Z'), subject_id: 14, status: 'on_duty', subjects: { name: 'DS' } },
      { attendance_date: new Date('2026-07-22T00:00:00.000Z'), subject_id: 14, status: 'absent', subjects: { name: 'DS' } },
    ];

    it('getAttendanceSummary: 2 of 3 days attended (present + on_duty), not 1 of 3', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 1 });
      prisma.attendance_records.findMany.mockResolvedValue(records);

      const result = await service.getAttendanceSummary(1, {} as any);

      expect(result.overall).toMatchObject({ present: 1, on_duty: 1, absent: 1, percentage: 66.67 });
      expect(result.by_subject[0]).toMatchObject({ present: 1, on_duty: 1, percentage: 66.67 });
    });

    it('getAttendanceBySemester: per-term percentage counts on_duty as attended', async () => {
      prisma.students.findUnique.mockResolvedValue({ batch_id: 1, class_id: null });
      prisma.academic_calendars.findMany.mockResolvedValue([
        { semester: 1, start_date: new Date('2026-07-01'), end_date: new Date('2026-07-31') },
      ]);
      prisma.attendance_records.findMany.mockResolvedValue(records);

      const result = await service.getAttendanceBySemester(1);

      expect(result[0]).toMatchObject({ present: 1, on_duty: 1, absent: 1, percentage: 66.67 });
    });

    it('getAttendanceRiskStudentIds: an on_duty-heavy student above threshold is not flagged as at-risk', async () => {
      // Student 1: 1 present + 4 on_duty out of 5 (80% attended) — must NOT
      // be flagged at a 75% threshold, even though present-only would be 20%.
      prisma.attendance_records.groupBy.mockResolvedValue([
        { student_id: 1, status: 'present', _count: { _all: 1 } },
        { student_id: 1, status: 'on_duty', _count: { _all: 4 } },
        { student_id: 2, status: 'absent', _count: { _all: 4 } },
        { student_id: 2, status: 'present', _count: { _all: 1 } },
      ]);

      const result = await service.getAttendanceRiskStudentIds({ threshold: 75 } as any);

      expect(result.ids).toEqual([2]);
      expect(result.ids).not.toContain(1);
    });
  });
});
