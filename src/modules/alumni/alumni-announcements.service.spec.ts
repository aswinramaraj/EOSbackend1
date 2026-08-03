import { Test, TestingModule } from '@nestjs/testing';
import { AlumniAnnouncementsService } from './alumni-announcements.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';

jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('AlumniAnnouncementsService', () => {
  let service: AlumniAnnouncementsService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      alumni_announcements: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AlumniAnnouncementsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AlumniAnnouncementsService>(
      AlumniAnnouncementsService,
    );
  });

  it('lists announcements with no batch filter — same feed for every alumnus', async () => {
    mockPrisma.alumni_announcements.findMany.mockResolvedValue([
      { id: 1, title: 'Reunion 2026', content: 'Details...', created_at: new Date() },
    ]);
    mockPrisma.alumni_announcements.count.mockResolvedValue(1);

    const result = await service.listAnnouncements(new PaginationDto());

    expect(mockPrisma.alumni_announcements.findMany).toHaveBeenCalledWith(
      expect.not.objectContaining({ where: expect.anything() }),
    );
    expect(result.data).toHaveLength(1);
  });

  it('creates an announcement with posted_by_user_id resolved from the JWT', async () => {
    mockPrisma.alumni_announcements.create.mockResolvedValue({ id: 1 });

    await service.createAnnouncement(42, {
      title: 'Reunion 2026',
      content: 'Join us!',
    });

    expect(mockPrisma.alumni_announcements.create).toHaveBeenCalledWith({
      data: { posted_by_user_id: 42, title: 'Reunion 2026', content: 'Join us!' },
    });
  });
});
