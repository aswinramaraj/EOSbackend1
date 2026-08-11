jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { LmsService } from './lms.service';

describe('LmsService', () => {
  let service: LmsService;
  let notifications: { notify: jest.Mock };
  let prisma: {
    faculty: { findUnique: jest.Mock };
    faculty_subject_class_mapping: { findFirst: jest.Mock };
    class_subjects: { findFirst: jest.Mock };
    assignments: { findFirst: jest.Mock; create: jest.Mock };
    students: { findMany: jest.Mock };
    student_assignment_status: { findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      faculty_subject_class_mapping: { findFirst: jest.fn() },
      class_subjects: { findFirst: jest.fn() },
      assignments: { findFirst: jest.fn(), create: jest.fn() },
      students: { findMany: jest.fn().mockResolvedValue([]) },
      student_assignment_status: { findUnique: jest.fn(), update: jest.fn() },
    };
    notifications = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LmsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: {} },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<LmsService>(LmsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createTask', () => {
    const dto = {
      subject_id: 5,
      class_ids: [10, 11],
      title: 'Unit 3 assignment',
      description: 'Solve all problems',
      due_date: '2026-09-01',
      max_marks: 20,
      task_type: 'assignment',
    } as any;

    beforeEach(() => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue({
        academic_year: '2026-2027',
      });
      prisma.class_subjects.findFirst.mockResolvedValue({ semester: 3 });
      prisma.assignments.findFirst.mockResolvedValue(null);
    });

    it('notifies every student in each target class, once per class', async () => {
      prisma.assignments.create
        .mockResolvedValueOnce({ id: 100 })
        .mockResolvedValueOnce({ id: 101 });
      prisma.students.findMany
        .mockResolvedValueOnce([{ user_id: 501 }, { user_id: 502 }])
        .mockResolvedValueOnce([{ user_id: 601 }]);

      await service.createTask(dto, 1);

      expect(prisma.students.findMany).toHaveBeenNthCalledWith(1, {
        where: { class_id: 10 },
        select: { user_id: true },
      });
      expect(prisma.students.findMany).toHaveBeenNthCalledWith(2, {
        where: { class_id: 11 },
        select: { user_id: true },
      });
      expect(notifications.notify).toHaveBeenCalledTimes(3);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 501,
          type: 'lms_task_assigned',
          related_entity_type: 'lms_task',
          related_entity_id: 100,
        }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 502,
          type: 'lms_task_assigned',
          related_entity_type: 'lms_task',
          related_entity_id: 100,
        }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 601,
          type: 'lms_task_assigned',
          related_entity_type: 'lms_task',
          related_entity_id: 101,
        }),
      );
    });

    it('sends no notifications (and does not error) when a target class has no students', async () => {
      prisma.assignments.create.mockResolvedValue({ id: 100 });
      prisma.students.findMany.mockResolvedValue([]);

      await service.createTask({ ...dto, class_ids: [10] }, 1);

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('403s when the faculty does not teach the subject to one of the classes', async () => {
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue(null);

      await expect(service.createTask(dto, 1)).rejects.toThrow(
        /not assigned to teach/,
      );
      expect(prisma.assignments.create).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });

  describe('gradeSubmission', () => {
    beforeEach(() => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 7 });
    });

    it('notifies the graded student with their marks', async () => {
      prisma.student_assignment_status.findUnique.mockResolvedValue({
        id: 55,
        assignments: { faculty_id: 7, max_marks: 20, title: 'Unit 3 assignment' },
        students: { user_id: 501 },
      });

      await service.gradeSubmission(55, { marks_obtained: 18 } as any, 1);

      expect(prisma.student_assignment_status.update).toHaveBeenCalledWith({
        where: { id: 55 },
        data: expect.objectContaining({ marks_obtained: 18 }),
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 501,
          type: 'lms_task_graded',
          related_entity_type: 'lms_task_submission',
          related_entity_id: 55,
        }),
      );
    });

    it('404s when the submission does not exist', async () => {
      prisma.student_assignment_status.findUnique.mockResolvedValue(null);

      await expect(
        service.gradeSubmission(999, { marks_obtained: 10 } as any, 1),
      ).rejects.toMatchObject({ status: 404 });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('403s when the submission belongs to a different faculty member', async () => {
      prisma.student_assignment_status.findUnique.mockResolvedValue({
        id: 55,
        assignments: { faculty_id: 8, max_marks: 20, title: 'Unit 3 assignment' },
        students: { user_id: 501 },
      });

      await expect(
        service.gradeSubmission(55, { marks_obtained: 10 } as any, 1),
      ).rejects.toMatchObject({ status: 403 });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('400s (and does not notify) when marks_obtained exceeds max_marks', async () => {
      prisma.student_assignment_status.findUnique.mockResolvedValue({
        id: 55,
        assignments: { faculty_id: 7, max_marks: 20, title: 'Unit 3 assignment' },
        students: { user_id: 501 },
      });

      await expect(
        service.gradeSubmission(55, { marks_obtained: 25 } as any, 1),
      ).rejects.toMatchObject({ status: 400 });
      expect(prisma.student_assignment_status.update).not.toHaveBeenCalled();
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });
});
