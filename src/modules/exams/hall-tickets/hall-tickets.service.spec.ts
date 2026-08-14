jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { HallTicketsService } from './hall-tickets.service';

describe('HallTicketsService', () => {
  let service: HallTicketsService;
  let notifications: { notify: jest.Mock };
  let prisma: {
    exams: { findUnique: jest.Mock };
    students: { findUnique: jest.Mock };
    exam_timetable: { findFirst: jest.Mock };
    hall_tickets: { findUnique: jest.Mock; create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      exams: { findUnique: jest.fn() },
      students: { findUnique: jest.fn() },
      exam_timetable: { findFirst: jest.fn() },
      hall_tickets: { findUnique: jest.fn(), create: jest.fn() },
    };
    notifications = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HallTicketsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<HallTicketsService>(HallTicketsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generate', () => {
    beforeEach(() => {
      prisma.exams.findUnique.mockResolvedValue({ id: 1, title: 'Semester Exam' });
      prisma.students.findUnique.mockResolvedValue({ id: 5, user_id: 501 });
      prisma.exam_timetable.findFirst.mockResolvedValue({ id: 20 });
      prisma.hall_tickets.findUnique.mockResolvedValue(null);
    });

    it('notifies the student once the hall ticket is created', async () => {
      prisma.hall_tickets.create.mockResolvedValue({ id: 77, exam_id: 1, student_id: 5 });

      await service.generate(1, 5);

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 501,
          type: 'hall_ticket_issued',
          related_entity_type: 'hall_ticket',
          related_entity_id: 77,
        }),
      );
    });

    it('404s when the exam does not exist, and never notifies', async () => {
      prisma.exams.findUnique.mockResolvedValue(null);

      await expect(service.generate(999, 5)).rejects.toMatchObject({
        response: { errorCode: 'EXAM_NOT_FOUND' },
      });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('409s when a hall ticket already exists, and never re-notifies', async () => {
      prisma.hall_tickets.findUnique.mockResolvedValue({ id: 1 });

      await expect(service.generate(1, 5)).rejects.toMatchObject({
        response: { errorCode: 'ALREADY_GENERATED' },
      });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('does not fail hall ticket generation if notifying the student throws', async () => {
      prisma.hall_tickets.create.mockResolvedValue({ id: 77, exam_id: 1, student_id: 5 });
      notifications.notify.mockRejectedValue(new Error('connection lost'));

      const result = await service.generate(1, 5);

      expect(result).toMatchObject({ id: 77 });
    });
  });
});
