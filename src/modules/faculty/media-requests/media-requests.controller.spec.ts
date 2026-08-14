jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications/notifications.service';
import { MediaRequestsController } from './media-requests.controller';
import { MediaRequestsService } from './media-requests.service';

describe('MediaRequestsController', () => {
  let controller: MediaRequestsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MediaRequestsController],
      providers: [
        MediaRequestsService,
        { provide: NotificationsService, useValue: { create: jest.fn() } },
        {
          provide: PrismaService,
          useValue: {
            faculty: { findUnique: jest.fn() },
            media_requests: {
              create: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<MediaRequestsController>(MediaRequestsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
