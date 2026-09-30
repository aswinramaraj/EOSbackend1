jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
  // Real Prisma.sql builds a tagged-template Sql object for $queryRaw; the
  // mocked $queryRaw below never actually parses it, it just needs
  // something to pass through — same stand-in as wallet.service.spec.ts.
  Prisma: {
    sql: (strings: unknown, ...values: unknown[]) => ({ strings, values }),
    join: (values: unknown[]) => ({ values }),
  },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { HodClassRecordsService } from './hod-class-records.service';

const hodUser: JwtPayload = { sub: 7, email: 'hod@eos.test', role: 'hod', roleId: 1 };

describe('HodClassRecordsService', () => {
  let service: HodClassRecordsService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    classes: { findMany: jest.Mock; findUnique: jest.Mock };
    students: { groupBy: jest.Mock; findMany: jest.Mock };
    class_mentors: { findFirst: jest.Mock };
    student_drive_applications: { findMany: jest.Mock };
    student_fee_demand_mapping: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      classes: { findMany: jest.fn(), findUnique: jest.fn() },
      students: { groupBy: jest.fn(), findMany: jest.fn() },
      class_mentors: { findFirst: jest.fn() },
      student_drive_applications: { findMany: jest.fn() },
      student_fee_demand_mapping: { findMany: jest.fn() },
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HodClassRecordsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<HodClassRecordsService>(HodClassRecordsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('404s FACULTY_NOT_FOUND when the caller has no faculty row (department cannot be resolved)', async () => {
    prisma.faculty.findUnique.mockResolvedValue(null);

    await expect(service.getClasses(hodUser)).rejects.toMatchObject({
      response: { errorCode: 'FACULTY_NOT_FOUND' },
    });
  });

  describe('department isolation', () => {
    it('404s CLASS_NOT_FOUND when the class belongs to a different department than the caller', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ department_id: 1 });
      prisma.classes.findUnique.mockResolvedValue({
        id: 99,
        section: 'A',
        current_semester: 3,
        classroom: 'B-101',
        department_id: 2, // a different department
        departments: { name: 'ECE', code: 'ECE' },
      });

      await expect(service.getClassDetail(hodUser, 99)).rejects.toMatchObject({
        response: { errorCode: 'CLASS_NOT_FOUND' },
      });
      expect(prisma.students.findMany).not.toHaveBeenCalled();
    });
  });

  describe('attendance percentage (on_duty counted as attended by the underlying SQL — see attendance-percentage.util.ts)', () => {
    it('getAttendanceOverview: mean_attendance comes straight from the department-scoped groupBy query', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ department_id: 1 });
      prisma.classes.findMany.mockResolvedValue([
        { id: 9, section: 'A', current_semester: 3 },
      ]);
      prisma.students.groupBy.mockResolvedValue([
        { class_id: 9, _count: { _all: 40 } },
      ]);
      prisma.$queryRaw.mockResolvedValue([{ class_id: 9, pct: '66.666666' }]);

      const result = await service.getAttendanceOverview(hodUser);

      expect(result[0]).toMatchObject({ class_id: 9, mean_attendance: 66.7 });
    });

    it('getClassDetail: attendance_percent comes straight from the per-student SQL query', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ department_id: 1 });
      prisma.classes.findUnique.mockResolvedValue({
        id: 9,
        section: 'A',
        current_semester: 3,
        classroom: 'B-101',
        department_id: 1,
        departments: { name: 'CSE', code: 'CSE' },
      });
      prisma.students.findMany.mockResolvedValue([
        {
          id: 1,
          student_id_no: '22CSE01',
          photo_url: null,
          soa_applications: { first_name: 'Test', last_name: 'Student' },
        },
      ]);
      prisma.class_mentors.findFirst.mockResolvedValue(null);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ student_id: 1, pct: '66.666666' }]) // attendance
        .mockResolvedValueOnce([]) // gpa
        .mockResolvedValueOnce([]); // arrears
      prisma.student_drive_applications.findMany.mockResolvedValue([]);
      prisma.student_fee_demand_mapping.findMany.mockResolvedValue([]);

      const result = await service.getClassDetail(hodUser, 9);

      expect(result.students[0].attendance_percent).toBe(66.7);
      expect(result.stats?.mean_attendance).toBe(66.7);
    });
  });
});
