import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from 'src/prisma/prisma.service';

describe('NotificationsService', () => {
  let service: NotificationsService;

  const mockPrismaService = {
    notifications: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<NotificationsService>(NotificationsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('create should persist a notification via Prisma', async () => {
    const dto = {
      user_id: 1,
      title: 'Overdue',
      message: 'Please return the book.',
    };
    mockPrismaService.notifications.create.mockResolvedValue({ id: 5, ...dto });

    const result = await service.create(dto);

    expect(mockPrismaService.notifications.create).toHaveBeenCalledWith({
      data: dto,
    });
    expect(result).toEqual({ id: 5, ...dto });
  });
});
