import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationService } from './push-notification.service';

describe('NotificationsController', () => {
  let controller: NotificationsController;
  const notificationsService = {
    findAllForUser: jest.fn(),
    getUnreadCount: jest.fn(),
    markAsRead: jest.fn(),
    markAllAsRead: jest.fn(),
  };
  const pushService = {
    registerToken: jest.fn(),
    unregisterToken: jest.fn(),
  };
  const user = { sub: 3, email: 'x@eos.test', role: 'student', roleId: 5 };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [NotificationsController],
      providers: [
        { provide: NotificationsService, useValue: notificationsService },
        { provide: PushNotificationService, useValue: pushService },
      ],
    }).compile();

    controller = module.get<NotificationsController>(NotificationsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates every route to the service with the caller resolved from the JWT', () => {
    controller.findAll(user);
    expect(notificationsService.findAllForUser).toHaveBeenCalledWith(3);

    controller.getUnreadCount(user);
    expect(notificationsService.getUnreadCount).toHaveBeenCalledWith(3);

    controller.markAsRead(7, user);
    expect(notificationsService.markAsRead).toHaveBeenCalledWith(7, 3);

    controller.markAllAsRead(user);
    expect(notificationsService.markAllAsRead).toHaveBeenCalledWith(3);

    controller.registerDevice({ push_token: 'ExponentPushToken[abc]', platform: 'android' }, user);
    expect(pushService.registerToken).toHaveBeenCalledWith(3, {
      push_token: 'ExponentPushToken[abc]',
      platform: 'android',
    });

    controller.unregisterDevice('ExponentPushToken[abc]');
    expect(pushService.unregisterToken).toHaveBeenCalledWith('ExponentPushToken[abc]');
  });
});
