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
import { HodStudentProfileService } from './hod-student-profile.service';

const hodUser: JwtPayload = { sub: 7, email: 'hod@eos.test', role: 'hod', roleId: 1 };

function studentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    student_id_no: '22CSE01',
    roll_no: '1',
    register_no: '22CSE01',
    admission_no: 'A1',
    admission_type: 'regular',
    admission_date: null,
    gender: 'male',
    date_of_birth: null,
    blood_group: null,
    mother_tongue: null,
    community: null,
    is_first_graduate: false,
    student_type: null,
    dayscholar_mode: null,
    photo_url: null,
    student_sensitive_info: null,
    classes: { id: 9, section: 'A', current_semester: null, department_id: 1, departments: { name: 'CSE', code: 'CSE' } },
    batches: { name: '2026-2030' },
    courses: { name: 'CSE' },
    quotas: null,
    users: { email: 's@eos.test' },
    soa_applications: { first_name: 'Test', last_name: 'Student', student_email: null, student_contact: null, cutoff_physics: null, cutoff_chemistry: null, cutoff_maths: null },
    student_contacts: null,
    student_addresses: [],
    student_family_details: null,
    student_certificates: [],
    ...overrides,
  };
}

describe('HodStudentProfileService', () => {
  let service: HodStudentProfileService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    students: { findUnique: jest.Mock };
    class_mentors: { findFirst: jest.Mock };
    class_subjects: { findMany: jest.Mock };
    student_fee_demand_mapping: { findMany: jest.Mock };
    student_drive_applications: { findMany: jest.Mock };
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      students: { findUnique: jest.fn() },
      class_mentors: { findFirst: jest.fn() },
      class_subjects: { findMany: jest.fn() },
      student_fee_demand_mapping: { findMany: jest.fn() },
      student_drive_applications: { findMany: jest.fn() },
      $queryRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HodStudentProfileService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<HodStudentProfileService>(HodStudentProfileService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('404s FACULTY_NOT_FOUND when the caller has no faculty row', async () => {
    prisma.faculty.findUnique.mockResolvedValue(null);

    await expect(service.getProfile(hodUser, 1)).rejects.toMatchObject({
      response: { errorCode: 'FACULTY_NOT_FOUND' },
    });
  });

  it('404s STUDENT_NOT_FOUND when the student belongs to a different department than the caller', async () => {
    prisma.faculty.findUnique.mockResolvedValue({ department_id: 1 });
    prisma.students.findUnique.mockResolvedValueOnce({
      classes: { id: 9, department_id: 2 }, // a different department
    });

    await expect(service.getProfile(hodUser, 1)).rejects.toMatchObject({
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
  });

  describe('attendance percentage (on_duty counted as attended by the underlying SQL — see attendance-percentage.util.ts)', () => {
    it('cumulative and monthly attendance_percent come straight from the pct SQL fields', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ department_id: 1 });
      prisma.students.findUnique
        .mockResolvedValueOnce({ classes: { id: 9, department_id: 1 } }) // assertOwnDepartmentStudent
        .mockResolvedValueOnce(studentRow()); // main profile select
      prisma.class_mentors.findFirst.mockResolvedValue(null);
      prisma.$queryRaw
        .mockResolvedValueOnce([{ pct: '66.666666' }]) // cumulative attendance
        .mockResolvedValueOnce([]) // gpa rows
        .mockResolvedValueOnce([{ month: '2026-07', pct: '66.666666' }]); // monthly attendance
      prisma.student_fee_demand_mapping.findMany.mockResolvedValue([]);
      prisma.student_drive_applications.findMany.mockResolvedValue([]);

      const result = await service.getProfile(hodUser, 1);

      expect(result.stats.attendance_percent).toBe(66.7);
      expect(result.monthly_attendance).toEqual([{ month: '2026-07', percent: 66.7 }]);
    });
  });
});
