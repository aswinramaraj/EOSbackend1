jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { AssignmentsService } from './assignments.service';

describe('AssignmentsService', () => {
  let service: AssignmentsService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    classes: { findUnique: jest.Mock };
    subjects: { findUnique: jest.Mock };
    faculty_subject_class_mapping: { findFirst: jest.Mock; findMany: jest.Mock };
    assignments: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    students: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      classes: { findUnique: jest.fn() },
      subjects: { findUnique: jest.fn() },
      faculty_subject_class_mapping: { findFirst: jest.fn(), findMany: jest.fn() },
      assignments: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      students: { findMany: jest.fn() },
      $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AssignmentsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<AssignmentsService>(AssignmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getHandledClasses', () => {
    it('throws 404 when the caller has no faculty profile', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(service.getHandledClasses(1)).rejects.toThrow(
        'Faculty profile not found for the authenticated user',
      );
    });

    it("scopes the query to the caller's own faculty_id and shapes each mapping", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        {
          class_id: 5,
          subject_id: 12,
          academic_year: '2025-26',
          classes: {
            section: 'A',
            current_semester: 5,
            departments: { name: 'Computer Science and Engineering' },
          },
          subjects: { name: 'Data Structures', subject_code: 'CS301' },
        },
      ]);

      const result = await service.getHandledClasses(1);

      const [args] = prisma.faculty_subject_class_mapping.findMany.mock
        .calls[0] as [{ where: Record<string, unknown> }];
      expect(args.where).toEqual({ faculty_id: 7 });
      expect(result).toEqual([
        {
          class_id: 5,
          subject_id: 12,
          academic_year: '2025-26',
          section: 'A',
          semester: 5,
          department_name: 'Computer Science and Engineering',
          subject_name: 'Data Structures',
          subject_code: 'CS301',
        },
      ]);
    });
  });

  describe('getAssignmentStudents', () => {
    it('throws 404 when the assignment does not exist', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.assignments.findUnique.mockResolvedValue(null);

      await expect(service.getAssignmentStudents(1, 1)).rejects.toThrow(
        'Assignment not found',
      );
    });

    it('throws 403 when the caller does not own the assignment', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.assignments.findUnique.mockResolvedValue({ id: 1, faculty_id: 99, class_id: 5 });

      await expect(service.getAssignmentStudents(1, 1)).rejects.toThrow(
        'You may only view students for your own assignments',
      );
    });

    it("lists every student in the assignment's class, with status defaults for those never marked", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.assignments.findUnique.mockResolvedValue({ id: 1, faculty_id: 7, class_id: 5 });
      prisma.students.findMany.mockResolvedValue([
        {
          id: 42,
          student_id_no: '23CS001',
          soa_applications: { first_name: 'Arjun', last_name: 'Kumar' },
          users: { email: 'arjun@sece.ac.in' },
          student_assignment_status: [
            { id: 900, is_submitted: true, marked_at: new Date('2026-08-01T00:00:00.000Z') },
          ],
        },
        {
          id: 43,
          student_id_no: '23CS002',
          soa_applications: null,
          users: { email: 'noname@sece.ac.in' },
          student_assignment_status: [],
        },
      ]);

      const result = await service.getAssignmentStudents(1, 1);

      const [args] = prisma.students.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toEqual({ class_id: 5 });
      expect(result).toEqual([
        {
          student_id: 42,
          student_id_no: '23CS001',
          name: 'Arjun Kumar',
          status_id: 900,
          is_submitted: true,
          marked_at: new Date('2026-08-01T00:00:00.000Z'),
        },
        {
          student_id: 43,
          student_id_no: '23CS002',
          name: 'noname@sece.ac.in',
          status_id: null,
          is_submitted: false,
          marked_at: null,
        },
      ]);
    });
  });
});
