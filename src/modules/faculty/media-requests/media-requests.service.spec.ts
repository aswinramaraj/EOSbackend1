jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications/notifications.service';
import { MediaRequestsService } from './media-requests.service';

describe('MediaRequestsService', () => {
  let service: MediaRequestsService;
  let mockNotificationsService: { create: jest.Mock };

  beforeEach(async () => {
    mockNotificationsService = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaRequestsService,
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
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    service = module.get<MediaRequestsService>(MediaRequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('notifies the requester when the media room updates the request status', async () => {
    const prisma = (service as unknown as { prisma: any }).prisma;
    prisma.media_requests.findUnique.mockResolvedValue({
      id: 3,
      status: 'pending',
      requested_by_user_id: 55,
    });
    prisma.media_requests.update.mockResolvedValue({
      id: 3,
      description: 'Symposium coverage',
      status: 'approved',
      media_file_url: null,
      created_at: new Date(),
      event_name: 'Symposium',
      event_date: new Date(),
      coordinator_name: 'Priya',
      contact_number: '9000000000',
      media_types: ['photography'],
      faculty: null,
      venues: null,
      users: { id: 55, email: 'sec@example.com', faculty: null, non_teaching_staff: [] },
    });

    await service.update(3, { status: 'approved' });

    expect(mockNotificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 55 }),
    );
  });
});
