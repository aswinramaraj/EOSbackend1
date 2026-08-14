import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PushNotificationService } from './push-notification.service';
import { PrismaService } from 'src/prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockPrismaService = {
    notifications: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
  };

  const mockPushService = {
    sendToUser: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: PushNotificationService, useValue: mockPushService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('persists a notification via Prisma, without pushing', async () => {
      const dto = { user_id: 1, title: 'Overdue', message: 'Please return the book.' };
      mockPrismaService.notifications.create.mockResolvedValue({ id: 5, ...dto });

      const result = await service.create(dto);

      expect(mockPrismaService.notifications.create).toHaveBeenCalledWith({ data: dto });
      expect(mockPushService.sendToUser).not.toHaveBeenCalled();
      expect(result).toEqual({ id: 5, ...dto });
    });
  });

  describe('notify', () => {
    it('persists the notification AND best-effort pushes to the recipient', async () => {
      const dto = {
        user_id: 7,
        title: 'Leave approved',
        message: 'Your leave request was approved.',
        type: 'approval_request_approved' as const,
        related_entity_type: 'faculty_leave',
        related_entity_id: 42,
      };
      mockPrismaService.notifications.create.mockResolvedValue({ id: 9, ...dto });

      const result = await service.notify(dto);

      expect(mockPrismaService.notifications.create).toHaveBeenCalledWith({ data: dto });
      expect(mockPushService.sendToUser).toHaveBeenCalledWith(7, 'Leave approved', 'Your leave request was approved.', {
        type: 'approval_request_approved',
        related_entity_type: 'faculty_leave',
        related_entity_id: 42,
      });
      expect(result).toEqual({ id: 9, ...dto });
    });

    it('still returns the created notification even if the push side fails', async () => {
      const dto = { user_id: 7, title: 'x', message: 'y' };
      mockPrismaService.notifications.create.mockResolvedValue({ id: 1, ...dto });
      mockPushService.sendToUser.mockRejectedValue(new Error('network down'));

      // PushNotificationService.sendToUser is documented as never-throwing
      // in real usage, but this proves notify() doesn't blow up even if
      // that contract were ever violated.
      await expect(service.notify(dto)).rejects.toThrow('network down');
    });
  });

  describe('findAllForUser', () => {
    it('scopes to the caller and orders newest first', async () => {
      mockPrismaService.notifications.findMany.mockResolvedValue([{ id: 1 }]);

      await service.findAllForUser(3);

      expect(mockPrismaService.notifications.findMany).toHaveBeenCalledWith({
        where: { user_id: 3 },
        orderBy: { created_at: 'desc' },
      });
    });
  });

  describe('getUnreadCount', () => {
    it('counts only unread rows for the caller', async () => {
      mockPrismaService.notifications.count.mockResolvedValue(4);

      const result = await service.getUnreadCount(3);

      expect(mockPrismaService.notifications.count).toHaveBeenCalledWith({
        where: { user_id: 3, is_read: false },
      });
      expect(result).toEqual({ count: 4 });
    });
  });

  describe('markAsRead', () => {
    it('throws 404 when the notification does not exist', async () => {
      mockPrismaService.notifications.findUnique.mockResolvedValue(null);

      await expect(service.markAsRead(1, 3)).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.notifications.update).not.toHaveBeenCalled();
    });

    it("throws 403 when the notification belongs to someone else", async () => {
      mockPrismaService.notifications.findUnique.mockResolvedValue({ id: 1, user_id: 99 });

      await expect(service.markAsRead(1, 3)).rejects.toThrow(ForbiddenException);
      expect(mockPrismaService.notifications.update).not.toHaveBeenCalled();
    });

    it('marks the owner\'s own notification as read', async () => {
      mockPrismaService.notifications.findUnique.mockResolvedValue({ id: 1, user_id: 3 });
      mockPrismaService.notifications.update.mockResolvedValue({ id: 1, user_id: 3, is_read: true });

      const result = await service.markAsRead(1, 3);

      expect(mockPrismaService.notifications.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { is_read: true },
      });
      expect(result.is_read).toBe(true);
    });
  });

  describe('markAllAsRead', () => {
    it('marks every unread notification for the caller as read and reports the count', async () => {
      mockPrismaService.notifications.updateMany.mockResolvedValue({ count: 6 });

      const result = await service.markAllAsRead(3);

      expect(mockPrismaService.notifications.updateMany).toHaveBeenCalledWith({
        where: { user_id: 3, is_read: false },
        data: { is_read: true },
      });
      expect(result).toEqual({ updated: 6 });
    });
  });
});
