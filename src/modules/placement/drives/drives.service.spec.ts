import { Test, TestingModule } from '@nestjs/testing';
import { DrivesService } from './drives.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { NotificationsService } from '../../notifications/notifications/notifications.service';

// The real PrismaService pulls in the generated Prisma client, which uses
// `import.meta.url` and cannot be parsed by ts-jest's CommonJS transform.
// Mock it out before it's ever required.
jest.mock('../../../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('DrivesService', () => {
  let service: DrivesService;
  let notifications: { notify: jest.Mock };
  let prisma: {
    students: { findUnique: jest.Mock; findMany: jest.Mock };
    student_drive_applications: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    faculty: { findUnique: jest.Mock };
    class_mentors: { findMany: jest.Mock; findFirst: jest.Mock };
    classes: { findMany: jest.Mock; findUnique: jest.Mock };
    placement_drives: { findMany: jest.Mock; findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn(), findMany: jest.fn() },
      student_drive_applications: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      faculty: { findUnique: jest.fn() },
      class_mentors: { findMany: jest.fn(), findFirst: jest.fn() },
      classes: { findMany: jest.fn(), findUnique: jest.fn() },
      placement_drives: { findMany: jest.fn(), findUnique: jest.fn() },
    };
    notifications = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DrivesService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompaniesService, useValue: {} },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<DrivesService>(DrivesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  const jwtUser = { sub: 1, email: 'x@x.com', role: 'student', roleId: 6 };

  function driveApplication(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      status: 'applied',
      updated_at: new Date('2026-08-01T00:00:00.000Z'),
      placement_drives: {
        id: 10,
        scheduled_date: new Date('2026-09-01T00:00:00.000Z'),
        status: 'scheduled',
        is_disclosed: true,
        disclosed_reveal_date: null,
        job_role: null,
        package_lpa: null,
        companies: { name: 'TCS', profile_info: 'IT services' },
      },
      ...overrides,
    };
  }

  describe('getUpcomingForStudent', () => {
    it('throws 404 when the JWT user has no linked student record', async () => {
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(service.getUpcomingForStudent(jwtUser)).rejects.toThrow(
        'Student profile not found for the current user',
      );
    });

    it('filters to non-concluded statuses, ordered by soonest scheduled_date', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([]);

      await service.getUpcomingForStudent(jwtUser);

      const [args] = prisma.student_drive_applications.findMany.mock
        .calls[0] as [{ where: Record<string, unknown>; orderBy: unknown }];
      expect(args.where).toEqual({
        student_id: 42,
        status: { notIn: ['rejected', 'placed'] },
      });
      expect(args.orderBy).toEqual({
        placement_drives: { scheduled_date: 'asc' },
      });
    });

    it('includes the application_status field in the response', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([
        driveApplication({ status: 'r1_cleared' }),
      ]);

      const result = await service.getUpcomingForStudent(jwtUser);

      expect(result).toEqual([
        {
          drive_id: 10,
          company_name: 'TCS',
          company_profile_info: 'IT services',
          scheduled_date: new Date('2026-09-01T00:00:00.000Z'),
          is_disclosed: true,
          disclosed_reveal_date: null,
          job_role: null,
          package_lpa: null,
          application_status: 'r1_cleared',
        },
      ]);
    });

    it('masks the company name/profile and surfaces disclosed_reveal_date for an undisclosed drive', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([
        driveApplication({
          placement_drives: {
            id: 11,
            scheduled_date: new Date('2026-09-10T00:00:00.000Z'),
            status: 'scheduled',
            is_disclosed: false,
            disclosed_reveal_date: new Date('2026-09-05T00:00:00.000Z'),
            job_role: null,
            package_lpa: null,
            companies: { name: 'Secret Corp', profile_info: 'Stealth mode' },
          },
        }),
      ]);

      const result = await service.getUpcomingForStudent(jwtUser);

      expect(result[0]).toEqual({
        drive_id: 11,
        company_name: 'Undisclosed',
        company_profile_info: null,
        scheduled_date: new Date('2026-09-10T00:00:00.000Z'),
        is_disclosed: false,
        disclosed_reveal_date: new Date('2026-09-05T00:00:00.000Z'),
        job_role: null,
        package_lpa: null,
        application_status: 'applied',
        last_cleared_round: undefined,
      });
    });
  });

  describe('getPostedForStudent', () => {
    it('throws 404 when the JWT user has no linked student record', async () => {
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(service.getPostedForStudent(jwtUser)).rejects.toThrow(
        'Student profile not found for the current user',
      );
    });

    it('excludes drives already shortlisted for, filters to scheduled/upcoming', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([
        { drive_id: 10 },
      ]);
      prisma.placement_drives.findMany.mockResolvedValue([]);

      await service.getPostedForStudent(jwtUser);

      const [shortlistArgs] = prisma.student_drive_applications.findMany.mock
        .calls[0] as [{ where: Record<string, unknown> }];
      expect(shortlistArgs.where).toEqual({ student_id: 42 });

      const [driveArgs] = prisma.placement_drives.findMany.mock.calls[0] as [
        { where: Record<string, unknown>; orderBy: unknown },
      ];
      expect(driveArgs.where).toMatchObject({
        status: 'scheduled',
        id: { notIn: [10] },
      });
      expect(driveArgs.orderBy).toEqual({ scheduled_date: 'asc' });
    });

    it('is read-only/informational — never touches student_drive_applications.create', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([]);
      prisma.placement_drives.findMany.mockResolvedValue([
        {
          id: 20,
          scheduled_date: new Date('2026-09-15T00:00:00.000Z'),
          is_disclosed: true,
          disclosed_reveal_date: null,
          job_role: 'SDE',
          package_lpa: 12,
          companies: { name: 'Acme', profile_info: 'Widgets' },
        },
      ]);

      const result = await service.getPostedForStudent(jwtUser);

      expect(result).toEqual([
        {
          drive_id: 20,
          company_name: 'Acme',
          company_profile_info: 'Widgets',
          scheduled_date: new Date('2026-09-15T00:00:00.000Z'),
          is_disclosed: true,
          disclosed_reveal_date: null,
          job_role: 'SDE',
          package_lpa: 12,
        },
      ]);
    });

    it('masks the company name/profile for an undisclosed drive, same as getUpcomingForStudent', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([]);
      prisma.placement_drives.findMany.mockResolvedValue([
        {
          id: 21,
          scheduled_date: new Date('2026-09-20T00:00:00.000Z'),
          is_disclosed: false,
          disclosed_reveal_date: new Date('2026-09-18T00:00:00.000Z'),
          job_role: null,
          package_lpa: null,
          companies: { name: 'Secret Corp', profile_info: 'Stealth mode' },
        },
      ]);

      const result = await service.getPostedForStudent(jwtUser);

      expect(result[0]).toEqual({
        drive_id: 21,
        company_name: 'Undisclosed',
        company_profile_info: null,
        scheduled_date: new Date('2026-09-20T00:00:00.000Z'),
        is_disclosed: false,
        disclosed_reveal_date: new Date('2026-09-18T00:00:00.000Z'),
        job_role: null,
        package_lpa: null,
      });
    });
  });

  describe('getHistoryForStudent', () => {
    it('throws 404 when the JWT user has no linked student record', async () => {
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(service.getHistoryForStudent(jwtUser)).rejects.toThrow(
        'Student profile not found for the current user',
      );
    });

    it('filters to concluded application statuses (placed/rejected) only', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([]);

      await service.getHistoryForStudent(jwtUser);

      const [args] = prisma.student_drive_applications.findMany.mock
        .calls[0] as [{ where: Record<string, unknown> }];
      expect(args.where).toEqual({
        student_id: 42,
        status: { in: ['rejected', 'placed'] },
      });
    });

    it('includes application_status and drive_status, and masks an undisclosed company', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([
        driveApplication({
          status: 'placed',
          last_cleared_round: 3,
          placement_drives: {
            id: 12,
            scheduled_date: new Date('2026-08-01T00:00:00.000Z'),
            status: 'scheduled',
            is_disclosed: false,
            disclosed_reveal_date: null,
            job_role: null,
            package_lpa: null,
            companies: { name: 'Secret Corp', profile_info: null },
          },
        }),
      ]);

      const result = await service.getHistoryForStudent(jwtUser);

      expect(result).toEqual([
        {
          drive_id: 12,
          company_name: 'Undisclosed',
          scheduled_date: new Date('2026-08-01T00:00:00.000Z'),
          drive_status: 'scheduled',
          job_role: null,
          package_lpa: null,
          application_status: 'placed',
          last_cleared_round: 3,
        },
      ]);
    });

    it('surfaces last_cleared_round for a student rejected after clearing a round', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([
        driveApplication({ status: 'rejected', last_cleared_round: 2 }),
      ]);

      const result = await service.getHistoryForStudent(jwtUser);

      expect(result[0]).toMatchObject({
        application_status: 'rejected',
        last_cleared_round: 2,
      });
    });

    it('leaves last_cleared_round null for a student rejected before clearing any round', async () => {
      prisma.students.findUnique.mockResolvedValue({ id: 42 });
      prisma.student_drive_applications.findMany.mockResolvedValue([
        driveApplication({ status: 'rejected', last_cleared_round: null }),
      ]);

      const result = await service.getHistoryForStudent(jwtUser);

      expect(result[0]).toMatchObject({
        application_status: 'rejected',
        last_cleared_round: null,
      });
    });
  });

  describe('updateApplicationStatus', () => {
    const jwtActor = { sub: 10, email: 'staff@x.com', role: 'placement', roleId: 1 };

    function mockExistingApplication() {
      prisma.student_drive_applications.findUnique.mockResolvedValue({
        id: 99,
        drive_id: 1,
        student_id: 42,
        status: 'applied',
        last_cleared_round: null,
      });
    }

    it.each([
      ['r1_cleared', 1],
      ['r2_cleared', 2],
      ['r3_cleared', 3],
      ['placed', 3],
    ] as const)(
      'sets last_cleared_round to %s when status becomes %s',
      async (status, expectedRound) => {
        mockExistingApplication();
        prisma.student_drive_applications.update.mockResolvedValue({});

        await service.updateApplicationStatus(jwtActor, 1, 42, { status });

        const [args] = prisma.student_drive_applications.update.mock
          .calls[0] as [{ data: Record<string, unknown> }];
        expect(args.data).toMatchObject({
          status,
          last_cleared_round: expectedRound,
        });
      },
    );

    it('does not touch last_cleared_round when the new status is rejected', async () => {
      mockExistingApplication();
      prisma.student_drive_applications.update.mockResolvedValue({});

      await service.updateApplicationStatus(jwtActor, 1, 42, {
        status: 'rejected',
      });

      const [args] = prisma.student_drive_applications.update.mock
        .calls[0] as [{ data: Record<string, unknown> }];
      expect(args.data).not.toHaveProperty('last_cleared_round');
      expect(args.data).toMatchObject({ status: 'rejected' });
    });

    it('does not touch last_cleared_round when the new status is applied', async () => {
      mockExistingApplication();
      prisma.student_drive_applications.update.mockResolvedValue({});

      await service.updateApplicationStatus(jwtActor, 1, 42, {
        status: 'applied',
      });

      const [args] = prisma.student_drive_applications.update.mock
        .calls[0] as [{ data: Record<string, unknown> }];
      expect(args.data).not.toHaveProperty('last_cleared_round');
    });

    it('notifies the student of the new status', async () => {
      mockExistingApplication();
      prisma.student_drive_applications.update.mockResolvedValue({});
      prisma.students.findUnique.mockResolvedValue({ user_id: 501 });
      prisma.placement_drives.findUnique.mockResolvedValue({ companies: { name: 'TCS' } });

      await service.updateApplicationStatus(jwtActor, 1, 42, { status: 'r1_cleared' });

      expect(prisma.students.findUnique).toHaveBeenCalledWith({
        where: { id: 42 },
        select: { user_id: true },
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 501,
          type: 'placement_status_updated',
          related_entity_type: 'drive_application',
          related_entity_id: 1,
        }),
      );
    });

    it('does not fail the status update if notifying the student throws', async () => {
      mockExistingApplication();
      prisma.student_drive_applications.update.mockResolvedValue({ id: 99, status: 'r1_cleared' });
      prisma.students.findUnique.mockRejectedValue(new Error('connection lost'));

      const result = await service.updateApplicationStatus(jwtActor, 1, 42, { status: 'r1_cleared' });

      expect(result).toMatchObject({ id: 99 });
    });
  });

  describe('getUpcomingDrivesForFaculty', () => {
    it('lists every scheduled drive with no status field, masking undisclosed companies', async () => {
      prisma.placement_drives.findMany.mockResolvedValue([
        {
          id: 1,
          scheduled_date: new Date('2026-09-01T00:00:00.000Z'),
          is_disclosed: true,
          disclosed_reveal_date: null,
          companies: { name: 'TCS', profile_info: 'IT services' },
        },
        {
          id: 2,
          scheduled_date: new Date('2026-09-10T00:00:00.000Z'),
          is_disclosed: false,
          disclosed_reveal_date: new Date('2026-09-05T00:00:00.000Z'),
          companies: { name: 'Secret Corp', profile_info: 'Stealth mode' },
        },
      ]);

      const result = await service.getUpcomingDrivesForFaculty();

      const [args] = prisma.placement_drives.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toEqual({ status: 'scheduled' });
      expect(result).toEqual([
        {
          drive_id: 1,
          company_name: 'TCS',
          company_profile_info: 'IT services',
          scheduled_date: new Date('2026-09-01T00:00:00.000Z'),
          is_disclosed: true,
          disclosed_reveal_date: null,
        },
        {
          drive_id: 2,
          company_name: 'Undisclosed',
          company_profile_info: null,
          scheduled_date: new Date('2026-09-10T00:00:00.000Z'),
          is_disclosed: false,
          disclosed_reveal_date: new Date('2026-09-05T00:00:00.000Z'),
        },
      ]);
      expect(result[0]).not.toHaveProperty('application_status');
    });
  });

  describe('getMentoredStudents', () => {
    it('throws 404 when the caller has no faculty profile', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(service.getMentoredStudents(1)).rejects.toThrow(
        'Faculty profile not found for the authenticated user',
      );
    });

    it('returns an empty list (not an error) when the faculty mentors no class', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.class_mentors.findMany.mockResolvedValue([]);

      const result = await service.getMentoredStudents(1);

      expect(result).toEqual([]);
      expect(prisma.students.findMany).not.toHaveBeenCalled();
    });

    it('lists every student in a mentored class, resolving name/section/department', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.class_mentors.findMany.mockResolvedValue([{ class_id: 5 }]);
      prisma.students.findMany.mockResolvedValue([
        {
          id: 42,
          student_id_no: '23CS001',
          soa_applications: { first_name: 'Arjun', last_name: 'Kumar' },
          users: { email: 'arjun@sece.ac.in' },
          classes: { section: 'A', departments: { name: 'Computer Science and Engineering' } },
        },
        {
          id: 43,
          student_id_no: '23CS002',
          soa_applications: null,
          users: { email: 'noname@sece.ac.in' },
          classes: null,
        },
      ]);

      const result = await service.getMentoredStudents(1);

      const [args] = prisma.students.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toEqual({ class_id: { in: [5] } });
      expect(result).toEqual([
        {
          student_id: 42,
          student_id_no: '23CS001',
          name: 'Arjun Kumar',
          section: 'A',
          department_name: 'Computer Science and Engineering',
        },
        {
          student_id: 43,
          student_id_no: '23CS002',
          name: 'noname@sece.ac.in',
          section: null,
          department_name: null,
        },
      ]);
    });
  });

  describe('getStudentPlacementHistoryForMentor', () => {
    it('throws 404 when the student does not exist', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(
        service.getStudentPlacementHistoryForMentor(42, 1),
      ).rejects.toThrow('Student not found');
    });

    it('throws 403 when the caller does not mentor this student\'s class', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.students.findUnique.mockResolvedValue({ id: 42, class_id: 5 });
      prisma.class_mentors.findFirst.mockResolvedValue(null);

      await expect(
        service.getStudentPlacementHistoryForMentor(42, 1),
      ).rejects.toThrow("You are not the mentor for this student's class");
    });

    it("returns the student's placement history once mentor authorization passes", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.students.findUnique.mockResolvedValue({ id: 42, class_id: 5 });
      prisma.class_mentors.findFirst.mockResolvedValue({ id: 1 });
      prisma.student_drive_applications.findMany.mockResolvedValue([
        driveApplication({ status: 'placed', last_cleared_round: 3 }),
      ]);

      const result = await service.getStudentPlacementHistoryForMentor(42, 1);

      const [args] = prisma.student_drive_applications.findMany.mock
        .calls[0] as [{ where: Record<string, unknown> }];
      expect(args.where).toMatchObject({ student_id: 42 });
      expect(result).toEqual([
        {
          drive_id: 10,
          company_name: 'TCS',
          scheduled_date: new Date('2026-09-01T00:00:00.000Z'),
          drive_status: 'scheduled',
          job_role: null,
          package_lpa: null,
          application_status: 'placed',
          last_cleared_round: 3,
        },
      ]);
    });
  });

  describe('getDepartmentClasses', () => {
    it('throws 404 when the caller has no faculty profile', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(service.getDepartmentClasses(1)).rejects.toThrow(
        'Faculty profile not found for the authenticated user',
      );
    });

    it("lists every class in the HoD's own department, most recent batch first", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7, department_id: 2 });
      prisma.classes.findMany.mockResolvedValue([
        {
          id: 5,
          section: 'A',
          current_semester: 5,
          batches: { name: '2022-2026', start_year: 2022 },
          courses: { name: 'Computer Science and Engineering', code: 'CS' },
        },
      ]);

      const result = await service.getDepartmentClasses(1);

      const [args] = prisma.classes.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toEqual({ department_id: 2 });
      expect(result).toEqual([
        {
          class_id: 5,
          section: 'A',
          semester: 5,
          batch_name: '2022-2026',
          course_name: 'Computer Science and Engineering',
          course_code: 'CS',
        },
      ]);
    });
  });

  describe('getDepartmentStudents', () => {
    it('throws 404 when the caller has no faculty profile', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(service.getDepartmentStudents(1)).rejects.toThrow(
        'Faculty profile not found for the authenticated user',
      );
    });

    it('throws 403 when classId belongs to a different department', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7, department_id: 2 });
      prisma.classes.findUnique.mockResolvedValue({ department_id: 99 });

      await expect(service.getDepartmentStudents(1, 5)).rejects.toThrow(
        'This class is not in your department',
      );
      expect(prisma.students.findMany).not.toHaveBeenCalled();
    });

    it('throws 403 when classId does not exist at all', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7, department_id: 2 });
      prisma.classes.findUnique.mockResolvedValue(null);

      await expect(service.getDepartmentStudents(1, 5)).rejects.toThrow(
        'This class is not in your department',
      );
    });

    it('scopes to just the one class when classId is given', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7, department_id: 2 });
      prisma.classes.findUnique.mockResolvedValue({ department_id: 2 });
      prisma.students.findMany.mockResolvedValue([]);

      await service.getDepartmentStudents(1, 5);

      expect(prisma.classes.findMany).not.toHaveBeenCalled();
      const [args] = prisma.students.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toEqual({ class_id: { in: [5] } });
    });

    it('returns an empty list (not an error) when the department has no classes yet', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7, department_id: 2 });
      prisma.classes.findMany.mockResolvedValue([]);

      const result = await service.getDepartmentStudents(1);

      expect(result).toEqual([]);
      expect(prisma.students.findMany).not.toHaveBeenCalled();
    });

    it('lists every student across every class of the department, not just mentored ones', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7, department_id: 2 });
      prisma.classes.findMany.mockResolvedValue([{ id: 5 }, { id: 6 }]);
      prisma.students.findMany.mockResolvedValue([
        {
          id: 42,
          student_id_no: '23CS001',
          soa_applications: { first_name: 'Arjun', last_name: 'Kumar' },
          users: { email: 'arjun@sece.ac.in' },
          classes: { section: 'A', departments: { name: 'Computer Science and Engineering' } },
        },
      ]);

      const result = await service.getDepartmentStudents(1);

      const [classesArgs] = prisma.classes.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(classesArgs.where).toEqual({ department_id: 2 });
      const [studentsArgs] = prisma.students.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(studentsArgs.where).toEqual({ class_id: { in: [5, 6] } });
      expect(result).toEqual([
        {
          student_id: 42,
          student_id_no: '23CS001',
          name: 'Arjun Kumar',
          section: 'A',
          department_name: 'Computer Science and Engineering',
        },
      ]);
    });
  });

  describe('getStudentPlacementHistoryForHod', () => {
    it('throws 404 when the student does not exist', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7, department_id: 2 });
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(
        service.getStudentPlacementHistoryForHod(42, 1),
      ).rejects.toThrow('Student not found');
    });

    it("throws 403 when the student's class is in a different department", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7, department_id: 2 });
      prisma.students.findUnique.mockResolvedValue({
        id: 42,
        classes: { department_id: 99 },
      });

      await expect(
        service.getStudentPlacementHistoryForHod(42, 1),
      ).rejects.toThrow('This student is not in your department');
    });

    it('throws 403 when the student has no class at all', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7, department_id: 2 });
      prisma.students.findUnique.mockResolvedValue({ id: 42, classes: null });

      await expect(
        service.getStudentPlacementHistoryForHod(42, 1),
      ).rejects.toThrow('This student is not in your department');
    });

    it("returns the student's placement history once department authorization passes", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7, department_id: 2 });
      prisma.students.findUnique.mockResolvedValue({
        id: 42,
        classes: { department_id: 2 },
      });
      prisma.student_drive_applications.findMany.mockResolvedValue([
        driveApplication({ status: 'placed', last_cleared_round: 3 }),
      ]);

      const result = await service.getStudentPlacementHistoryForHod(42, 1);

      const [args] = prisma.student_drive_applications.findMany.mock
        .calls[0] as [{ where: Record<string, unknown> }];
      expect(args.where).toMatchObject({ student_id: 42 });
      expect(result).toEqual([
        {
          drive_id: 10,
          company_name: 'TCS',
          scheduled_date: new Date('2026-09-01T00:00:00.000Z'),
          drive_status: 'scheduled',
          job_role: null,
          package_lpa: null,
          application_status: 'placed',
          last_cleared_round: 3,
        },
      ]);
    });
  });
});
