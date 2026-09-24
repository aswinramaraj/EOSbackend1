jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { TimetablePeriodRequestsService } from './timetable-period-requests.service';

function slotRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 41,
    day_of_week: 1,
    period_number: 4,
    class_id: 9,
    faculty_id: 5,
    subject_id: 12,
    academic_year: '2026-2027',
    semester: 5,
    ...overrides,
  };
}

// One wide joined row, matching what queryRows()'s raw SQL would really
// return — used to mock $queryRawUnsafe for loadRequestRow()/listMine().
function requestRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    request_type: 'takeover',
    request_date: new Date('2026-09-21T00:00:00.000Z'),
    class_id: 9,
    from_faculty_id: 5,
    to_faculty_id: 6,
    primary_slot_id: 41,
    secondary_slot_id: null,
    covering_subject_id: null,
    status: 'pending',
    created_at: new Date('2026-09-20T10:00:00.000Z'),
    decided_at: null,
    from_faculty_first_name: 'Deepa',
    from_faculty_last_name: 'Kannan',
    to_faculty_first_name: 'Arun',
    to_faculty_last_name: 'Raj',
    class_section: 'A',
    class_department_code: 'CSE',
    class_department_name: 'Computer Science',
    class_semester: 5,
    primary_period_number: 4,
    primary_start_time: new Date('1970-01-01T11:45:00.000Z'),
    primary_end_time: new Date('1970-01-01T12:35:00.000Z'),
    primary_subject_id: 12,
    primary_subject_name: 'Operating Systems',
    primary_subject_code: 'CS501',
    secondary_period_number: null,
    secondary_start_time: null,
    secondary_end_time: null,
    secondary_subject_id: null,
    secondary_subject_name: null,
    secondary_subject_code: null,
    secondary_class_id: null,
    secondary_class_section: null,
    secondary_class_department_code: null,
    secondary_class_department_name: null,
    secondary_class_semester: null,
    covering_subject_name: null,
    covering_subject_code: null,
    ...overrides,
  };
}

describe('TimetablePeriodRequestsService', () => {
  let service: TimetablePeriodRequestsService;
  let notifications: { notify: jest.Mock };
  let prisma: {
    faculty: { findUnique: jest.Mock; findMany: jest.Mock };
    timetable_slots: { findUnique: jest.Mock; findMany: jest.Mock };
    $queryRawUnsafe: jest.Mock;
    $executeRawUnsafe: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn(), findMany: jest.fn() },
      timetable_slots: { findUnique: jest.fn(), findMany: jest.fn() },
      $queryRawUnsafe: jest.fn(),
      $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    };
    notifications = { notify: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimetablePeriodRequestsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<TimetablePeriodRequestsService>(
      TimetablePeriodRequestsService,
    );
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createTakeover', () => {
    it("creates a takeover request for the caller's own slot and notifies the covering faculty", async () => {
      prisma.faculty.findUnique
        .mockResolvedValueOnce({ id: 5, user_id: 100 }) // resolveFacultyByUserId
        .mockResolvedValueOnce({ id: 6 }) // assertFacultyExists
        .mockResolvedValueOnce({ id: 6, user_id: 200 }); // notifyRequestCreated -> to faculty's user
      prisma.timetable_slots.findUnique.mockResolvedValue(slotRow());
      // assertNoConflictingRequest -> no conflict
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // conflict check
        .mockResolvedValueOnce([{ id: 1 }]) // insert RETURNING id
        .mockResolvedValueOnce([requestRow()]); // loadRequestRow

      const result = await service.createTakeover(100, {
        primary_slot_id: 41,
        to_faculty_id: 6,
        request_date: '2026-09-21', // a real Monday
      });

      expect(result.id).toBe(1);
      expect(result.request_type).toBe('takeover');
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 200,
          type: 'approval_request_pending',
          related_entity_type: 'timetable_period_request',
        }),
      );
    });

    it('rejects when the caller does not own the slot', async () => {
      prisma.faculty.findUnique.mockResolvedValueOnce({
        id: 999,
        user_id: 100,
      });
      prisma.timetable_slots.findUnique.mockResolvedValue(
        slotRow({ faculty_id: 5 }),
      );

      await expect(
        service.createTakeover(100, {
          primary_slot_id: 41,
          to_faculty_id: 6,
          request_date: '2026-09-21',
        }),
      ).rejects.toMatchObject({ response: { errorCode: 'NOT_YOUR_SLOT' } });
    });

    it("rejects when the given date is not the slot's real weekday", async () => {
      prisma.faculty.findUnique.mockResolvedValueOnce({ id: 5, user_id: 100 });
      prisma.timetable_slots.findUnique.mockResolvedValue(
        slotRow({ day_of_week: 1 }),
      ); // Monday

      await expect(
        service.createTakeover(100, {
          primary_slot_id: 41,
          to_faculty_id: 6,
          request_date: '2026-09-22',
        }), // a Tuesday
      ).rejects.toMatchObject({
        response: { errorCode: 'DATE_WEEKDAY_MISMATCH' },
      });
    });

    it('degrades to a clear FEATURE_NOT_ENABLED error pre-migration instead of crashing', async () => {
      prisma.faculty.findUnique
        .mockResolvedValueOnce({ id: 5, user_id: 100 })
        .mockResolvedValueOnce({ id: 6 });
      prisma.timetable_slots.findUnique.mockResolvedValue(slotRow());
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // conflict check (table doesn't exist yet is also possible, but keep this path simple)
        .mockRejectedValueOnce({
          code: 'P2010',
          meta: {
            code: '42P01',
            message: 'relation "timetable_period_requests" does not exist',
          },
        });

      await expect(
        service.createTakeover(100, {
          primary_slot_id: 41,
          to_faculty_id: 6,
          request_date: '2026-09-21',
        }),
      ).rejects.toMatchObject({
        response: { errorCode: 'FEATURE_NOT_ENABLED' },
      });
    });
  });

  describe('createSwap', () => {
    it("derives to_faculty_id from the secondary slot's real owner, never from client input", async () => {
      prisma.faculty.findUnique
        .mockResolvedValueOnce({ id: 5, user_id: 100 })
        .mockResolvedValueOnce({ id: 7, user_id: 300 });
      prisma.timetable_slots.findUnique
        .mockResolvedValueOnce(
          slotRow({ id: 41, faculty_id: 5, period_number: 4, day_of_week: 1 }),
        )
        .mockResolvedValueOnce(
          slotRow({ id: 42, faculty_id: 7, period_number: 6, day_of_week: 1 }),
        );
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // conflict check on primary
        .mockResolvedValueOnce([]) // conflict check on secondary
        .mockResolvedValueOnce([{ id: 2 }]) // insert RETURNING id
        .mockResolvedValueOnce([
          requestRow({
            id: 2,
            request_type: 'swap',
            to_faculty_id: 7,
            secondary_slot_id: 42,
          }),
        ]);

      const result = await service.createSwap(100, {
        primary_slot_id: 41,
        secondary_slot_id: 42,
        request_date: '2026-09-21',
      });

      expect(result.to_faculty.id).toBe(7);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 300 }),
      );
    });

    it('rejects swapping with your own other period', async () => {
      prisma.faculty.findUnique.mockResolvedValueOnce({ id: 5, user_id: 100 });
      prisma.timetable_slots.findUnique
        .mockResolvedValueOnce(slotRow({ id: 41, faculty_id: 5 }))
        .mockResolvedValueOnce(slotRow({ id: 42, faculty_id: 5 }));

      await expect(
        service.createSwap(100, {
          primary_slot_id: 41,
          secondary_slot_id: 42,
          request_date: '2026-09-21',
        }),
      ).rejects.toThrow(
        'Pick a period taught by a different faculty member to swap with.',
      );
    });
  });

  describe('respond', () => {
    it('lets the covering faculty accept, persisting the covering subject', async () => {
      prisma.faculty.findUnique
        .mockResolvedValueOnce({ id: 6, user_id: 200 }) // resolveFacultyByUserId (the responder)
        .mockResolvedValueOnce({ user_id: 100 }); // notifyRequestDecided -> from_faculty's user
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([
          requestRow({ to_faculty_id: 6, status: 'pending' }),
        ]) // loadRequestRow (existing)
        .mockResolvedValueOnce([
          requestRow({
            to_faculty_id: 6,
            status: 'accepted',
            covering_subject_id: 20,
          }),
        ]); // loadRequestRow (updated)

      const result = await service.respond(200, 1, {
        decision: 'accepted',
        covering_subject_id: 20,
      });

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE timetable_period_requests'),
        'accepted',
        200,
        20,
        1,
      );
      expect(result.status).toBe('accepted');
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'approval_request_approved' }),
      );
    });

    it('rejects when the caller is not the faculty the request was sent to', async () => {
      prisma.faculty.findUnique.mockResolvedValueOnce({
        id: 999,
        user_id: 200,
      });
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        requestRow({ to_faculty_id: 6, status: 'pending' }),
      ]);

      await expect(
        service.respond(200, 1, { decision: 'accepted' }),
      ).rejects.toMatchObject({
        response: { errorCode: 'NOT_YOUR_REQUEST' },
      });
    });

    it('rejects responding to an already-decided request', async () => {
      prisma.faculty.findUnique.mockResolvedValueOnce({ id: 6, user_id: 200 });
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        requestRow({ to_faculty_id: 6, status: 'accepted' }),
      ]);

      await expect(
        service.respond(200, 1, { decision: 'rejected' }),
      ).rejects.toMatchObject({
        response: { errorCode: 'ALREADY_DECIDED' },
      });
    });
  });

  describe('cancel', () => {
    it('lets the requester withdraw their own still-pending request', async () => {
      prisma.faculty.findUnique.mockResolvedValueOnce({ id: 5, user_id: 100 });
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        requestRow({ from_faculty_id: 5, status: 'pending' }),
      ]);

      const result = await service.cancel(100, 1);

      expect(result).toEqual({ id: 1, status: 'cancelled' });
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining("SET status = 'cancelled'"),
        100,
        1,
      );
    });

    it("rejects cancelling a request that is not the caller's own", async () => {
      prisma.faculty.findUnique.mockResolvedValueOnce({
        id: 999,
        user_id: 100,
      });
      prisma.$queryRawUnsafe.mockResolvedValueOnce([
        requestRow({ from_faculty_id: 5, status: 'pending' }),
      ]);

      await expect(service.cancel(100, 1)).rejects.toMatchObject({
        response: { errorCode: 'NOT_YOUR_REQUEST' },
      });
    });
  });

  describe('listColleaguesForDate', () => {
    it("returns same-department colleagues (excluding self) with each one's periods for that date", async () => {
      prisma.faculty.findUnique.mockResolvedValueOnce({
        id: 5,
        user_id: 100,
        department_id: 3,
      });
      prisma.faculty.findMany.mockResolvedValueOnce([
        {
          id: 6,
          first_name: 'Arun',
          last_name: 'Raj',
          designation: 'Assistant Professor',
          profile_url: null,
        },
      ]);
      prisma.timetable_slots.findMany.mockResolvedValueOnce([
        {
          id: 42,
          faculty_id: 6,
          period_number: 6,
          start_time: new Date('1970-01-01T13:35:00.000Z'),
          end_time: new Date('1970-01-01T14:25:00.000Z'),
          subjects: { id: 20, name: 'Data Structures', subject_code: 'CS502' },
          classes: {
            id: 9,
            section: 'A',
            current_semester: 5,
            departments: { code: 'CSE', name: 'Computer Science' },
          },
        },
      ]);

      const result = await service.listColleaguesForDate(100, '2026-09-21'); // a Monday

      expect(prisma.faculty.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { department_id: 3, status: 'active', id: { not: 5 } },
        }),
      );
      expect(prisma.timetable_slots.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { faculty_id: { in: [6] }, day_of_week: 1 },
        }),
      );
      expect(result).toEqual([
        {
          id: 6,
          name: 'Arun Raj',
          designation: 'Assistant Professor',
          profile_url: null,
          periods: [
            {
              slot_id: 42,
              period_number: 6,
              start_time: '13:35',
              end_time: '14:25',
              subject: { id: 20, name: 'Data Structures', code: 'CS502' },
              class: {
                id: 9,
                section: 'A',
                department_code: 'CSE',
                department_name: 'Computer Science',
                semester: 5,
              },
            },
          ],
        },
      ]);
    });

    it('returns an empty list without querying slots when the department has no other faculty', async () => {
      prisma.faculty.findUnique.mockResolvedValueOnce({
        id: 5,
        user_id: 100,
        department_id: 3,
      });
      prisma.faculty.findMany.mockResolvedValueOnce([]);

      const result = await service.listColleaguesForDate(100, '2026-09-21');

      expect(result).toEqual([]);
      expect(prisma.timetable_slots.findMany).not.toHaveBeenCalled();
    });
  });

  describe('overlay reads degrade gracefully pre-migration', () => {
    it('getAcceptedOverridesForClassDate returns an empty array instead of throwing when the table does not exist yet', async () => {
      prisma.$queryRawUnsafe.mockRejectedValueOnce({
        code: 'P2010',
        meta: {
          code: '42P01',
          message: 'relation "timetable_period_requests" does not exist',
        },
      });

      await expect(
        service.getAcceptedOverridesForClassDate(9, '2026-09-21'),
      ).resolves.toEqual([]);
    });

    it('getAcceptedOverridesForFacultyDate returns an empty array instead of throwing when the table does not exist yet', async () => {
      prisma.$queryRawUnsafe.mockRejectedValueOnce({
        code: 'P2010',
        meta: {
          code: '42P01',
          message: 'relation "timetable_period_requests" does not exist',
        },
      });

      await expect(
        service.getAcceptedOverridesForFacultyDate(5, '2026-09-21'),
      ).resolves.toEqual([]);
    });
  });
});
