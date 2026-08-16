jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/modules/storage/storage.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { AppraisalService } from './appraisal.service';

describe('AppraisalService', () => {
  let service: AppraisalService;
  let notifications: { notify: jest.Mock };
  let prisma: {
    faculty: { findUnique: jest.Mock };
    departments: { findUnique: jest.Mock };
    users: { findMany: jest.Mock };
    appraisal_criteria: { findMany: jest.Mock };
    appraisal_divisions: { findUnique: jest.Mock };
    appraisal_requests: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    appraisal_entries: {
      createMany: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    appraisal_attachments: {
      createMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let storage: { upload: jest.Mock; remove: jest.Mock };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      departments: { findUnique: jest.fn() },
      users: { findMany: jest.fn().mockResolvedValue([]) },
      appraisal_criteria: { findMany: jest.fn() },
      appraisal_divisions: { findUnique: jest.fn() },
      appraisal_requests: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      appraisal_entries: {
        createMany: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      appraisal_attachments: {
        createMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    storage = { upload: jest.fn(), remove: jest.fn() };
    notifications = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppraisalService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<AppraisalService>(AppraisalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  function requestRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      academic_year: '2025-2026',
      status: 'submitted',
      hod_reviewed_at: null,
      management_approved_at: null,
      created_at: new Date(),
      faculty: {
        id: 5,
        first_name: 'A',
        last_name: 'B',
        designation: 'Prof',
        department_id: 2,
        departments: { name: 'CSE' },
      },
      users_appraisal_requests_hod_reviewed_byTousers: null,
      users_appraisal_requests_management_approved_byTousers: null,
      appraisal_entries: [],
      appraisal_attachments: [],
      ...overrides,
    };
  }

  describe('create', () => {
    it("starts an HoD's own submission already at hod_reviewed, skipping the HoD-review stage", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });
      prisma.appraisal_requests.findFirst.mockResolvedValue(null);
      prisma.appraisal_criteria.findMany.mockResolvedValue([
        { id: 1, academic_year: '2025-2026' },
      ]);
      const txCreate = jest.fn().mockResolvedValue({ id: 1 });
      const txFindUniqueOrThrow = jest
        .fn()
        .mockResolvedValue(requestRow({ status: 'hod_reviewed' }));
      prisma.$transaction.mockImplementation((cb: any) =>
        cb({
          appraisal_requests: { create: txCreate, findUniqueOrThrow: txFindUniqueOrThrow },
          appraisal_entries: { createMany: jest.fn() },
        }),
      );

      const result = await service.create(
        { academic_year: '2025-2026', entries: [{ criteria_id: 1 }] } as any,
        { sub: 23, role: ROLES.HOD } as any,
      );

      const [args] = txCreate.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(args.data).toMatchObject({
        status: 'hod_reviewed',
        hod_reviewed_by: 23,
        hod_reviewed_at: expect.any(Date),
      });
      expect(result.status).toBe('hod_reviewed');
    });

    it('leaves a FACULTY caller\'s own submission at the default submitted status', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5, department_id: 2 });
      prisma.appraisal_requests.findFirst.mockResolvedValue(null);
      prisma.appraisal_criteria.findMany.mockResolvedValue([
        { id: 1, academic_year: '2025-2026' },
      ]);
      const txCreate = jest.fn().mockResolvedValue({ id: 1 });
      prisma.$transaction.mockImplementation((cb: any) =>
        cb({
          appraisal_requests: { create: txCreate, findUniqueOrThrow: jest.fn().mockResolvedValue(requestRow()) },
          appraisal_entries: { createMany: jest.fn() },
        }),
      );

      await service.create(
        { academic_year: '2025-2026', entries: [{ criteria_id: 1 }] } as any,
        { sub: 1, role: ROLES.FACULTY } as any,
      );

      const [args] = txCreate.mock.calls[0] as [{ data: Record<string, unknown> }];
      expect(args.data).toEqual({ faculty_id: 5, academic_year: '2025-2026' });
    });

    it("notifies the department HoD when a non-HoD faculty member submits", async () => {
      prisma.faculty.findUnique.mockImplementation(({ where }: any) =>
        where.user_id === 1
          ? Promise.resolve({ id: 5, department_id: 2, first_name: 'Ada', last_name: 'Lovelace' })
          : where.id === 40
            ? Promise.resolve({ user_id: 777 })
            : Promise.resolve(null),
      );
      prisma.departments.findUnique.mockResolvedValue({ head_of_department_faculty_id: 40 });
      prisma.appraisal_requests.findFirst.mockResolvedValue(null);
      prisma.appraisal_criteria.findMany.mockResolvedValue([
        { id: 1, academic_year: '2025-2026' },
      ]);
      prisma.$transaction.mockImplementation((cb: any) =>
        cb({
          appraisal_requests: {
            create: jest.fn().mockResolvedValue({ id: 42 }),
            findUniqueOrThrow: jest.fn().mockResolvedValue(requestRow({ id: 42 })),
          },
          appraisal_entries: { createMany: jest.fn() },
        }),
      );

      await service.create(
        { academic_year: '2025-2026', entries: [{ criteria_id: 1 }] } as any,
        { sub: 1, role: ROLES.FACULTY } as any,
      );

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 777,
          type: 'approval_request_pending',
          related_entity_type: 'appraisal_request',
          related_entity_id: 42,
        }),
      );
    });

    it("does not notify anyone when an HoD submits their own appraisal (skips the HoD stage)", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });
      prisma.appraisal_requests.findFirst.mockResolvedValue(null);
      prisma.appraisal_criteria.findMany.mockResolvedValue([
        { id: 1, academic_year: '2025-2026' },
      ]);
      prisma.$transaction.mockImplementation((cb: any) =>
        cb({
          appraisal_requests: {
            create: jest.fn().mockResolvedValue({ id: 1 }),
            findUniqueOrThrow: jest.fn().mockResolvedValue(requestRow({ status: 'hod_reviewed' })),
          },
          appraisal_entries: { createMany: jest.fn() },
        }),
      );

      await service.create(
        { academic_year: '2025-2026', entries: [{ criteria_id: 1 }] } as any,
        { sub: 23, role: ROLES.HOD } as any,
      );

      expect(prisma.departments.findUnique).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it("force-scopes a FACULTY caller's own faculty_id, ignoring any faculty_id query param", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5, department_id: 2 });
      prisma.appraisal_requests.findMany.mockResolvedValue([]);
      prisma.appraisal_requests.count.mockResolvedValue(0);
      prisma.$transaction.mockImplementation((queries: Promise<unknown>[]) => Promise.all(queries));

      await service.findAll(
        { faculty_id: 999, limit: 20, page: 1, skip: 0 } as any,
        { sub: 1, role: ROLES.FACULTY } as any,
      );

      const [args] = prisma.appraisal_requests.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toMatchObject({ faculty_id: 5 });
    });

    it("scopes a HOD caller to their own department, via the caller's own faculty row", async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });
      prisma.appraisal_requests.findMany.mockResolvedValue([]);
      prisma.appraisal_requests.count.mockResolvedValue(0);
      prisma.$transaction.mockImplementation((queries: Promise<unknown>[]) => Promise.all(queries));

      await service.findAll(
        { limit: 20, page: 1, skip: 0 } as any,
        { sub: 23, role: ROLES.HOD } as any,
      );

      const [args] = prisma.appraisal_requests.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where).toMatchObject({ faculty: { department_id: 2 } });
    });

    it('does not scope an HR Payroll caller at all', async () => {
      prisma.appraisal_requests.findMany.mockResolvedValue([]);
      prisma.appraisal_requests.count.mockResolvedValue(0);
      prisma.$transaction.mockImplementation((queries: Promise<unknown>[]) => Promise.all(queries));

      await service.findAll(
        { limit: 20, page: 1, skip: 0 } as any,
        { sub: 40, role: ROLES.HR_PAYROLL } as any,
      );

      expect(prisma.faculty.findUnique).not.toHaveBeenCalled();
      const [args] = prisma.appraisal_requests.findMany.mock.calls[0] as [
        { where: Record<string, unknown> },
      ];
      expect(args.where.faculty).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('throws 403 when a FACULTY caller requests a request that is not their own', async () => {
      prisma.appraisal_requests.findUnique.mockResolvedValue(requestRow());
      prisma.faculty.findUnique.mockResolvedValue({ id: 999, department_id: 2 });

      await expect(
        service.findOne(1, { sub: 1, role: ROLES.FACULTY } as any),
      ).rejects.toThrow('You may only view your own appraisal requests');
    });

    it('throws 403 when a HOD caller requests a request from a different department', async () => {
      prisma.appraisal_requests.findUnique.mockResolvedValue(requestRow());
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 99 });

      await expect(
        service.findOne(1, { sub: 23, role: ROLES.HOD } as any),
      ).rejects.toThrow('You may only view appraisal requests from your own department');
    });

    it('allows a HOD caller to view a request from their own department', async () => {
      prisma.appraisal_requests.findUnique.mockResolvedValue(requestRow());
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });

      const result = await service.findOne(1, { sub: 23, role: ROLES.HOD } as any);

      expect(result.id).toBe(1);
      expect(result.faculty!.department_name).toBe('CSE');
    });
  });

  describe('update', () => {
    it('throws 403 when a HOD caller reviews their own appraisal request', async () => {
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 9,
        status: 'submitted',
        faculty: { department_id: 2 },
      });
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });

      await expect(
        service.update(1, { status: 'hod_reviewed' } as any, { sub: 23, role: ROLES.HOD } as any),
      ).rejects.toMatchObject({ response: { errorCode: 'CANNOT_REVIEW_OWN_REQUEST' } });
      expect(prisma.appraisal_requests.update).not.toHaveBeenCalled();
    });

    it('throws 403 when a HOD caller reviews a request from a different department', async () => {
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        status: 'submitted',
        faculty: { department_id: 99 },
      });
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });

      await expect(
        service.update(1, { status: 'hod_reviewed' } as any, { sub: 23, role: ROLES.HOD } as any),
      ).rejects.toThrow('You may only review appraisal requests from your own department');
      expect(prisma.appraisal_requests.update).not.toHaveBeenCalled();
    });

    it('lets a HOD caller forward a submitted request from their own department to HR (hod_reviewed), notifying the faculty member and every HR Payroll account', async () => {
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'submitted',
        faculty: { department_id: 2 },
      });
      prisma.faculty.findUnique.mockImplementation(({ where }: any) =>
        where.user_id === 23
          ? Promise.resolve({ id: 9, department_id: 2 })
          : where.id === 5
            ? Promise.resolve({ user_id: 501 })
            : Promise.resolve(null),
      );
      prisma.users.findMany.mockResolvedValue([{ id: 900 }]);
      prisma.appraisal_requests.update.mockResolvedValue(requestRow({ status: 'hod_reviewed' }));

      const result = await service.update(
        1,
        { status: 'hod_reviewed' } as any,
        { sub: 23, role: ROLES.HOD } as any,
      );

      expect(prisma.appraisal_requests.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'hod_reviewed', hod_reviewed_by: 23, hod_reviewed_at: expect.any(Date) },
        select: expect.any(Object),
      });
      expect(result.status).toBe('hod_reviewed');
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 501, type: 'approval_request_pending', related_entity_type: 'appraisal_request' }),
      );
      expect(prisma.users.findMany).toHaveBeenCalledWith({
        where: { roles: { name: 'hr_payroll' } },
        select: { id: true },
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 900, type: 'approval_request_pending' }),
      );
    });

    it('lets a HOD caller reject a submitted request from their own department, notifying the faculty member', async () => {
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'submitted',
        faculty: { department_id: 2 },
      });
      prisma.faculty.findUnique.mockImplementation(({ where }: any) =>
        where.user_id === 23
          ? Promise.resolve({ id: 9, department_id: 2 })
          : where.id === 5
            ? Promise.resolve({ user_id: 501 })
            : Promise.resolve(null),
      );
      prisma.appraisal_requests.update.mockResolvedValue(requestRow({ status: 'rejected' }));

      await service.update(1, { status: 'rejected' } as any, { sub: 23, role: ROLES.HOD } as any);

      expect(prisma.appraisal_requests.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { status: 'rejected', hod_reviewed_by: 23, hod_reviewed_at: expect.any(Date) },
        select: expect.any(Object),
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 501, type: 'approval_request_rejected' }),
      );
      // Rejected does not move to HR - no role broadcast.
      expect(prisma.users.findMany).not.toHaveBeenCalled();
    });

    it('throws 409 when a HOD caller reviews a request that has already moved past submitted', async () => {
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        status: 'hod_reviewed',
        faculty: { department_id: 2 },
      });
      prisma.faculty.findUnique.mockResolvedValue({ id: 9, department_id: 2 });

      await expect(
        service.update(1, { status: 'hod_reviewed' } as any, { sub: 23, role: ROLES.HOD } as any),
      ).rejects.toThrow('This appraisal request has already moved past the HoD review stage');
    });
  });

  describe('update (HR Payroll stage)', () => {
    beforeEach(() => {
      prisma.faculty.findUnique.mockImplementation(({ where }: any) =>
        where.id === 5 ? Promise.resolve({ user_id: 501 }) : Promise.resolve(null),
      );
    });

    it("notifies the faculty member once entries are scored (hr_scored)", async () => {
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'hod_reviewed',
        faculty: { department_id: 2 },
      });
      prisma.appraisal_entries.findMany.mockResolvedValue([
        { id: 11, appraisal_criteria: { max_score: 10 } },
      ]);
      prisma.$transaction.mockImplementation((cb: any) =>
        cb({
          appraisal_entries: { update: jest.fn() },
          appraisal_requests: { update: jest.fn().mockResolvedValue(requestRow({ status: 'hr_scored' })) },
        }),
      );

      await service.update(
        1,
        { status: 'hr_scored', entries: [{ entry_id: 11, score: 8 }] } as any,
        { sub: 40, role: ROLES.HR_PAYROLL } as any,
      );

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 501, type: 'approval_request_pending', related_entity_type: 'appraisal_request' }),
      );
    });

    it("notifies the faculty member on management_approved", async () => {
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'hr_scored',
        faculty: { department_id: 2 },
      });
      prisma.appraisal_requests.update.mockResolvedValue(requestRow({ status: 'management_approved' }));

      await service.update(1, { status: 'management_approved' } as any, { sub: 40, role: ROLES.HR_PAYROLL } as any);

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 501, type: 'approval_request_approved' }),
      );
    });

    it('notifies the faculty member when HR rejects', async () => {
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'hod_reviewed',
        faculty: { department_id: 2 },
      });
      prisma.appraisal_requests.update.mockResolvedValue(requestRow({ status: 'rejected' }));

      await service.update(1, { status: 'rejected' } as any, { sub: 40, role: ROLES.HR_PAYROLL } as any);

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 501, type: 'approval_request_rejected' }),
      );
    });
  });

  describe('addAttachments', () => {
    it('throws 404 when the JWT user has no linked faculty record', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(
        service.addAttachments(1, 1, [], 999),
      ).rejects.toThrow('Faculty profile not found for the authenticated user');
    });

    it('throws 403 when the request does not belong to the caller', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 999,
        status: 'submitted',
      });

      await expect(
        service.addAttachments(1, 1, [], 1),
      ).rejects.toThrow('You may only attach files to your own appraisal requests');
    });

    it('throws 409 when the request is no longer submitted', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'hod_reviewed',
      });

      await expect(
        service.addAttachments(1, 1, [], 1),
      ).rejects.toThrow('Files can only be attached while the request is still in the submitted stage');
    });

    it('throws 404 when the division does not exist', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'submitted',
      });
      prisma.appraisal_divisions.findUnique.mockResolvedValue(null);

      await expect(
        service.addAttachments(1, 1, [], 1),
      ).rejects.toThrow('Appraisal division not found');
    });

    it('uploads each file to storage and persists an attachment row per file', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'submitted',
      });
      prisma.appraisal_divisions.findUnique.mockResolvedValue({ id: 1, name: 'Teaching Effectiveness' });
      storage.upload
        .mockResolvedValueOnce({ url: 'https://example.com/a.pdf', path: '1/1/a.pdf' })
        .mockResolvedValueOnce({ url: 'https://example.com/b.pdf', path: '1/1/b.pdf' });
      prisma.appraisal_requests.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        academic_year: '2025-2026',
        status: 'submitted',
        hod_reviewed_at: null,
        management_approved_at: null,
        created_at: new Date(),
        faculty: {
          id: 5,
          first_name: 'A',
          last_name: 'B',
          designation: 'Prof',
          department_id: 2,
          departments: { name: 'CSE' },
        },
        users_appraisal_requests_hod_reviewed_byTousers: null,
        users_appraisal_requests_management_approved_byTousers: null,
        appraisal_entries: [],
        appraisal_attachments: [],
      });

      await service.addAttachments(
        1,
        1,
        [
          { buffer: Buffer.from('a'), originalname: 'a.pdf', mimetype: 'application/pdf' },
          { buffer: Buffer.from('b'), originalname: 'b.pdf', mimetype: 'application/pdf' },
        ] as any,
        1,
      );

      expect(storage.upload).toHaveBeenCalledTimes(2);
      expect(prisma.appraisal_attachments.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            appraisal_request_id: 1,
            division_id: 1,
            file_url: 'https://example.com/a.pdf',
            file_name: 'a.pdf',
          }),
          expect.objectContaining({
            appraisal_request_id: 1,
            division_id: 1,
            file_url: 'https://example.com/b.pdf',
            file_name: 'b.pdf',
          }),
        ],
      });
    });
  });

  describe('removeAttachment', () => {
    it('throws 403 when the request does not belong to the caller', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 999,
        status: 'submitted',
      });

      await expect(
        service.removeAttachment(1, 1, 1),
      ).rejects.toThrow('You may only remove attachments from your own appraisal requests');
    });

    it('throws 409 when the request is no longer submitted', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'hr_scored',
      });

      await expect(
        service.removeAttachment(1, 1, 1),
      ).rejects.toThrow('Attachments can only be removed while the request is still in the submitted stage');
    });

    it('throws 404 when the attachment does not belong to this request', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'submitted',
      });
      prisma.appraisal_attachments.findUnique.mockResolvedValue({
        id: 1,
        appraisal_request_id: 999,
        storage_path: 'x',
      });

      await expect(
        service.removeAttachment(1, 1, 1),
      ).rejects.toThrow('Attachment not found on this request');
    });

    it('deletes the DB row and removes the file from storage', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'submitted',
      });
      prisma.appraisal_attachments.findUnique.mockResolvedValue({
        id: 7,
        appraisal_request_id: 1,
        storage_path: '1/1/a.pdf',
      });

      const result = await service.removeAttachment(1, 7, 1);

      expect(prisma.appraisal_attachments.delete).toHaveBeenCalledWith({ where: { id: 7 } });
      expect(storage.remove).toHaveBeenCalledWith('1/1/a.pdf');
      expect(result).toEqual({ id: 7, deleted: true });
    });
  });
});
