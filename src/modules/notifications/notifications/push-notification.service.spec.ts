import { Test, TestingModule } from '@nestjs/testing';
import { PushNotificationService } from './push-notification.service';
import { PrismaService } from 'src/prisma/prisma.service';

describe('PushNotificationService', () => {
  let service: PushNotificationService;
  let mockPrisma: any;
  let fetchMock: jest.Mock;

  beforeEach(async () => {
    mockPrisma = {
      device_push_tokens: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
      },
    };

    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;

    const module: TestingModule = await Test.createTestingModule({
      providers: [PushNotificationService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<PushNotificationService>(PushNotificationService);
  });

  describe('registerToken', () => {
    it('upserts by push_token', async () => {
      await service.registerToken(5, { push_token: 'ExponentPushToken[abc]', platform: 'android' });

      expect(mockPrisma.device_push_tokens.upsert).toHaveBeenCalledWith({
        where: { push_token: 'ExponentPushToken[abc]' },
        create: { user_id: 5, push_token: 'ExponentPushToken[abc]', platform: 'android' },
        update: { user_id: 5, platform: 'android', updated_at: expect.any(Date) },
      });
    });
  });

  describe('unregisterToken', () => {
    it('deletes the token row', async () => {
      await service.unregisterToken('ExponentPushToken[abc]');

      expect(mockPrisma.device_push_tokens.deleteMany).toHaveBeenCalledWith({
        where: { push_token: 'ExponentPushToken[abc]' },
      });
    });
  });

  describe('sendToUser', () => {
    it('does nothing (and never calls fetch) when the user has no registered devices', async () => {
      mockPrisma.device_push_tokens.findMany.mockResolvedValue([]);

      await service.sendToUser(5, 'Title', 'Message');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends one Expo push request for all of the user's tokens", async () => {
      mockPrisma.device_push_tokens.findMany.mockResolvedValue([
        { push_token: 'ExponentPushToken[a]' },
        { push_token: 'ExponentPushToken[b]' },
      ]);
      fetchMock.mockResolvedValue({
        json: async () => ({ data: [{ status: 'ok' }, { status: 'ok' }] }),
      });

      await service.sendToUser(5, 'Leave approved', 'Your leave was approved', { type: 'approval_request_approved' });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://exp.host/--/api/v2/push/send',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify([
            {
              to: 'ExponentPushToken[a]',
              title: 'Leave approved',
              body: 'Your leave was approved',
              data: { type: 'approval_request_approved' },
              sound: 'default',
            },
            {
              to: 'ExponentPushToken[b]',
              title: 'Leave approved',
              body: 'Your leave was approved',
              data: { type: 'approval_request_approved' },
              sound: 'default',
            },
          ]),
        }),
      );
    });

    it('prunes a token Expo reports as DeviceNotRegistered', async () => {
      mockPrisma.device_push_tokens.findMany.mockResolvedValue([
        { push_token: 'ExponentPushToken[dead]' },
        { push_token: 'ExponentPushToken[alive]' },
      ]);
      fetchMock.mockResolvedValue({
        json: async () => ({
          data: [
            { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
            { status: 'ok' },
          ],
        }),
      });

      await service.sendToUser(5, 'Title', 'Message');

      expect(mockPrisma.device_push_tokens.deleteMany).toHaveBeenCalledWith({
        where: { push_token: { in: ['ExponentPushToken[dead]'] } },
      });
    });

    it('never throws even if the Expo request itself fails', async () => {
      mockPrisma.device_push_tokens.findMany.mockResolvedValue([{ push_token: 'ExponentPushToken[a]' }]);
      fetchMock.mockRejectedValue(new Error('network down'));

      await expect(service.sendToUser(5, 'Title', 'Message')).resolves.toBeUndefined();
    });
  });
});
