jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ComplaintsService } from './complaints.service';

describe('ComplaintsService', () => {
  let service: ComplaintsService;
  let notifications: { notify: jest.Mock };
  let prisma: {
    students: { findUnique: jest.Mock };
    hostel_complaints: { findUnique: jest.Mock; create: jest.Mock; update: jest.Mock; findMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };

  function complaintRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 1,
      title: 'Leaking tap',
      status: 'in_progress',
      category: 'maintenance',
      description: 'Tap in room leaks',
      priority: 'medium',
      assigned_to: null,
      resolution_note: null,
      resolved_at: null,
      created_at: new Date('2026-08-01T00:00:00.000Z'),
      students: {
        id: 5,
        user_id: 501,
        student_id_no: '23EC056',
        soa_applications: { first_name: 'Arjun', last_name: 'Kumar' },
        student_hostel_mapping: { hostel_rooms: { room_number: 'A101' } },
      },
      hostels: { id: 1, name: 'Block A', code: 'A' },
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      hostel_complaints: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    };
    notifications = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ComplaintsService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<ComplaintsService>(ComplaintsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('update', () => {
    it('notifies the student when status changes', async () => {
      prisma.hostel_complaints.findUnique.mockResolvedValue({ id: 1, status: 'open' });
      prisma.hostel_complaints.update.mockResolvedValue(complaintRow({ status: 'resolved' }));

      await service.update(1, { status: 'resolved' } as any);

      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 501,
          type: 'hostel_complaint_status_updated',
          related_entity_type: 'hostel_complaint',
          related_entity_id: 1,
        }),
      );
    });

    it('does not notify when status is left unchanged (e.g. only priority updated)', async () => {
      prisma.hostel_complaints.findUnique.mockResolvedValue({ id: 1, status: 'open' });
      prisma.hostel_complaints.update.mockResolvedValue(complaintRow({ status: 'open', priority: 'high' }));

      await service.update(1, { priority: 'high' } as any);

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('404s when the complaint does not exist, and never notifies', async () => {
      prisma.hostel_complaints.findUnique.mockResolvedValue(null);

      await expect(service.update(999, { status: 'resolved' } as any)).rejects.toMatchObject({
        response: { errorCode: 'COMPLAINT_NOT_FOUND' },
      });
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('does not fail the update if notifying the student throws', async () => {
      prisma.hostel_complaints.findUnique.mockResolvedValue({ id: 1, status: 'open' });
      prisma.hostel_complaints.update.mockResolvedValue(complaintRow({ status: 'resolved' }));
      notifications.notify.mockRejectedValue(new Error('connection lost'));

      const result = await service.update(1, { status: 'resolved' } as any);

      expect(result).toMatchObject({ id: 1, status: 'resolved' });
    });
  });
});
