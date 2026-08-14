import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminAlumniGroupsService } from './admin-alumni-groups.service';
import { PrismaService } from 'src/prisma/prisma.service';

jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('AdminAlumniGroupsService', () => {
  let service: AdminAlumniGroupsService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      alumni_batches: { findUnique: jest.fn() },
      alumni_group_messages: { findMany: jest.fn(), create: jest.fn() },
      alumni_members: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminAlumniGroupsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AdminAlumniGroupsService>(AdminAlumniGroupsService);
  });

  describe('getGroupDetail', () => {
    it('404s when the alumni batch does not exist', async () => {
      mockPrisma.alumni_batches.findUnique.mockResolvedValue(null);

      await expect(service.getGroupDetail(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns header info with member_count from the aggregate', async () => {
      mockPrisma.alumni_batches.findUnique.mockResolvedValue({
        id: 1,
        batch_id: 10,
        group_name: 'AI&DS 2022-2026 Alumni',
        graduated_on: new Date('2026-05-01'),
        batches: { id: 10, name: '2022-2026' },
        _count: { alumni_members: 2 },
      });

      const result = await service.getGroupDetail(1);

      expect(result).toEqual(
        expect.objectContaining({ id: 1, group_name: 'AI&DS 2022-2026 Alumni', member_count: 2 }),
      );
    });
  });

  describe('listTimeline', () => {
    beforeEach(() => {
      mockPrisma.alumni_batches.findUnique.mockResolvedValue({ id: 1 });
    });

    it('404s when the alumni batch does not exist', async () => {
      mockPrisma.alumni_batches.findUnique.mockResolvedValue(null);

      await expect(service.listTimeline(999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('merges real messages and real joins into one chronological feed', async () => {
      mockPrisma.alumni_group_messages.findMany.mockResolvedValue([
        {
          id: 1,
          content: 'Welcome!',
          attachment_url: null,
          created_at: new Date('2026-08-01T10:00:00.000Z'),
          alumni_members: null,
          users: { roles: { name: 'principal' } },
        },
      ]);
      mockPrisma.alumni_members.findMany.mockResolvedValue([
        {
          id: 1,
          joined_at: new Date('2026-07-29T09:00:00.000Z'),
          students: {
            soa_applications: { first_name: 'Arun', last_name: 'Karthik' },
            users: { email: 'arun@x.com' },
          },
        },
        {
          id: 2,
          joined_at: new Date('2026-07-29T09:05:00.000Z'),
          students: {
            soa_applications: { first_name: 'Priya', last_name: null },
            users: { email: 'priya@x.com' },
          },
        },
      ]);

      const result = await service.listTimeline(1);

      expect(result).toEqual([
        expect.objectContaining({
          kind: 'join',
          text: 'Arun Karthik and 1 other joined',
        }),
        expect.objectContaining({
          kind: 'message',
          posted_by_name: 'Principal',
          content: 'Welcome!',
        }),
      ]);
    });
  });

  describe('createMessageForBatch', () => {
    it('posts with posted_by_user_id, never posted_by_alumni_member_id', async () => {
      mockPrisma.alumni_batches.findUnique.mockResolvedValue({ id: 1 });
      mockPrisma.alumni_group_messages.create.mockResolvedValue({ id: 99 });

      await service.createMessageForBatch(42, 1, { content: 'Hello group' });

      expect(mockPrisma.alumni_group_messages.create).toHaveBeenCalledWith({
        data: {
          alumni_batch_id: 1,
          posted_by_user_id: 42,
          content: 'Hello group',
          attachment_url: undefined,
        },
      });
    });

    it('404s when the alumni batch does not exist', async () => {
      mockPrisma.alumni_batches.findUnique.mockResolvedValue(null);

      await expect(
        service.createMessageForBatch(42, 999, { content: 'hi' }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.alumni_group_messages.create).not.toHaveBeenCalled();
    });
  });
});
