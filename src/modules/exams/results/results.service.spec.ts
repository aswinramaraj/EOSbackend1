jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ResultsService } from './results.service';

describe('ResultsService', () => {
  let service: ResultsService;
  let notifications: { notify: jest.Mock };
  let prisma: {
    exams: { findUnique: jest.Mock };
    exam_subject_mapping: { findMany: jest.Mock };
    exam_marks: { findMany: jest.Mock };
    result_publications: {
      findFirst: jest.Mock;
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    students: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      exams: { findUnique: jest.fn() },
      exam_subject_mapping: { findMany: jest.fn() },
      exam_marks: { findMany: jest.fn().mockResolvedValue([]) },
      result_publications: {
        findFirst: jest.fn(),
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      students: { findMany: jest.fn().mockResolvedValue([]) },
    };
    notifications = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ResultsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<ResultsService>(ResultsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('publish', () => {
    beforeEach(() => {
      prisma.exams.findUnique.mockResolvedValue({ id: 1, title: 'Semester Exam' });
      prisma.exam_subject_mapping.findMany.mockResolvedValue([{ id: 10 }, { id: 11 }]);
      prisma.result_publications.findFirst.mockResolvedValue(null);
      prisma.result_publications.create.mockResolvedValue({ id: 99, exam_id: 1 });
    });

    it('notifies every student who has marks recorded for this exam', async () => {
      prisma.exam_marks.findMany
        // 1st call: mapping-completeness check (publish's own pre-existing logic).
        .mockResolvedValueOnce([{ exam_subject_mapping_id: 10 }, { exam_subject_mapping_id: 11 }])
        // 2nd call: notifyResultsPublished's distinct-student lookup.
        .mockResolvedValueOnce([{ student_id: 501 }, { student_id: 502 }]);
      prisma.students.findMany.mockResolvedValue([{ user_id: 5001 }, { user_id: 5002 }]);

      await service.publish(1, 9);

      expect(prisma.students.findMany).toHaveBeenCalledWith({
        where: { id: { in: [501, 502] } },
        select: { user_id: true },
      });
      expect(notifications.notify).toHaveBeenCalledTimes(2);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 5001,
          type: 'exam_result_published',
          related_entity_type: 'exam',
          related_entity_id: 1,
        }),
      );
    });

    it('404s when the exam does not exist, and never notifies', async () => {
      prisma.exams.findUnique.mockResolvedValue(null);

      await expect(service.publish(999, 9)).rejects.toMatchObject({
        response: { errorCode: 'EXAM_NOT_FOUND' },
      });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('409s when results were already published, and never re-notifies', async () => {
      prisma.exam_marks.findMany.mockResolvedValue([
        { exam_subject_mapping_id: 10 },
        { exam_subject_mapping_id: 11 },
      ]);
      prisma.result_publications.findFirst.mockResolvedValue({ id: 1 });

      await expect(service.publish(1, 9)).rejects.toMatchObject({
        response: { errorCode: 'ALREADY_PUBLISHED' },
      });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('does not fail the publish if notifying students throws', async () => {
      prisma.exam_marks.findMany
        .mockResolvedValueOnce([{ exam_subject_mapping_id: 10 }, { exam_subject_mapping_id: 11 }])
        .mockRejectedValueOnce(new Error('connection lost'));

      const result = await service.publish(1, 9);

      expect(result).toMatchObject({ id: 99 });
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });
});
