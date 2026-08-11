jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { RevaluationService } from './revaluation.service';

describe('RevaluationService', () => {
  let service: RevaluationService;
  let notifications: { notify: jest.Mock };
  let prisma: {
    exam_marks: { findUnique: jest.Mock };
    students: { findUnique: jest.Mock };
    revaluation_requests: {
      findFirst: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    users: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      exam_marks: { findUnique: jest.fn() },
      students: { findUnique: jest.fn() },
      revaluation_requests: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      users: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notifications = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RevaluationService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<RevaluationService>(RevaluationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    beforeEach(() => {
      prisma.exam_marks.findUnique.mockResolvedValue({ id: 1, max_marks: 100 });
      prisma.students.findUnique.mockResolvedValue({ id: 5, student_id_no: '23EC056' });
      prisma.revaluation_requests.findFirst.mockResolvedValue(null);
      prisma.revaluation_requests.create.mockResolvedValue({ id: 77 });
    });

    it('notifies every COE-role user of the new request', async () => {
      prisma.users.findMany.mockResolvedValue([{ id: 900 }, { id: 901 }]);

      await service.create({ exam_marks_id: 1, student_id: 5 } as any);

      expect(prisma.users.findMany).toHaveBeenCalledWith({
        where: { roles: { name: 'coe' } },
        select: { id: true },
      });
      expect(notifications.notify).toHaveBeenCalledTimes(2);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 900,
          type: 'approval_request_pending',
          related_entity_type: 'revaluation_request',
          related_entity_id: 77,
        }),
      );
    });

    it('409s when a request already exists for this exam mark, and never notifies', async () => {
      prisma.revaluation_requests.findFirst.mockResolvedValue({ id: 1 });

      await expect(service.create({ exam_marks_id: 1, student_id: 5 } as any)).rejects.toMatchObject({
        response: { errorCode: 'REVALUATION_REQUEST_EXISTS' },
      });
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it("notifies the requesting student when resolved as 'revised'", async () => {
      prisma.revaluation_requests.findUnique.mockResolvedValue({
        id: 77,
        status: 'requested',
        student_id: 5,
        exam_marks: { max_marks: 100 },
      });
      prisma.revaluation_requests.update.mockResolvedValue({ id: 77, status: 'revised' });
      prisma.students.findUnique.mockResolvedValue({ user_id: 5001 });

      await service.update(77, { status: 'revised', revised_marks: 85 } as any);

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 5001,
          type: 'approval_request_approved',
          related_entity_type: 'revaluation_request',
          related_entity_id: 77,
        }),
      );
    });

    it("notifies the requesting student when resolved as 'no_change'", async () => {
      prisma.revaluation_requests.findUnique.mockResolvedValue({
        id: 77,
        status: 'requested',
        student_id: 5,
        exam_marks: { max_marks: 100 },
      });
      prisma.revaluation_requests.update.mockResolvedValue({ id: 77, status: 'no_change' });
      prisma.students.findUnique.mockResolvedValue({ user_id: 5001 });

      await service.update(77, { status: 'no_change' } as any);

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 5001, type: 'approval_request_approved' }),
      );
    });

    it('409s when the request has already been processed, and never notifies', async () => {
      prisma.revaluation_requests.findUnique.mockResolvedValue({
        id: 77,
        status: 'revised',
        student_id: 5,
        exam_marks: { max_marks: 100 },
      });

      await expect(service.update(77, { status: 'no_change' } as any)).rejects.toMatchObject({
        response: { errorCode: 'REVALUATION_ALREADY_PROCESSED' },
      });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('does not notify when status is left unset (only revised_marks provided has no valid path here, but guards against no-op status)', async () => {
      prisma.revaluation_requests.findUnique.mockResolvedValue({
        id: 77,
        status: 'requested',
        student_id: 5,
        exam_marks: { max_marks: 100 },
      });
      prisma.revaluation_requests.update.mockResolvedValue({ id: 77 });

      await service.update(77, {} as any);

      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });
});
