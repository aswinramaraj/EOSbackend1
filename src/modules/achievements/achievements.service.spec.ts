import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AchievementsService } from './achievements.service';
import { PrismaService } from 'src/prisma/prisma.service';

jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('AchievementsService', () => {
  let service: AchievementsService;
  let mockPrisma: any;

  const secretaryUser = { sub: 1, email: 's@eos.test', role: 'secretary', roleId: 1 };
  const mediaUser = { sub: 2, email: 'm@eos.test', role: 'media_room', roleId: 2 };
  const adminUser = { sub: 3, email: 'a@eos.test', role: 'admin', roleId: 3 };

  beforeEach(async () => {
    mockPrisma = {
      departments: { findUnique: jest.fn() },
      department_achievements: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      achievement_media: {
        aggregate: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      achievement_comments: {
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AchievementsService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AchievementsService>(AchievementsService);
  });

  describe('create', () => {
    it('throws 404 when the department does not exist', async () => {
      mockPrisma.departments.findUnique.mockResolvedValue(null);

      await expect(
        service.create(secretaryUser, {
          department_id: 99,
          title: 'Won a hackathon',
          media: [{ media_type: 'photo', media_url: 'https://x.com/a.jpg' }],
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('assigns sequence numbers 1..n to media in submission order', async () => {
      mockPrisma.departments.findUnique.mockResolvedValue({ id: 1 });
      mockPrisma.department_achievements.create.mockResolvedValue({ id: 10 });

      await service.create(mediaUser, {
        department_id: 1,
        title: 'Won a hackathon',
        media: [
          { media_type: 'photo', media_url: 'https://x.com/a.jpg' },
          { media_type: 'video', media_url: 'https://x.com/b.mp4' },
        ],
      } as any);

      expect(mockPrisma.department_achievements.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            posted_by_user_id: 2,
            achievement_media: {
              create: [
                expect.objectContaining({
                  media_url: 'https://x.com/a.jpg',
                  sequence_no: 1,
                }),
                expect.objectContaining({
                  media_url: 'https://x.com/b.mp4',
                  sequence_no: 2,
                }),
              ],
            },
          }),
        }),
      );
    });
  });

  describe('update/remove — ownership', () => {
    it('403s when a non-owner, non-admin tries to update', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: 1, // posted by secretaryUser
      });

      await expect(
        service.update(mediaUser, 5, { title: 'Edited' }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.department_achievements.update).not.toHaveBeenCalled();
    });

    it('allows the original poster to update', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: 1,
      });
      mockPrisma.department_achievements.update.mockResolvedValue({ id: 5 });

      await service.update(secretaryUser, 5, { title: 'Edited' });

      expect(mockPrisma.department_achievements.update).toHaveBeenCalled();
    });

    it('allows admin to update someone else\'s post (oversight)', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: 1,
      });
      mockPrisma.department_achievements.update.mockResolvedValue({ id: 5 });

      await service.update(adminUser, 5, { title: 'Edited by admin' });

      expect(mockPrisma.department_achievements.update).toHaveBeenCalled();
    });

    it('403s a non-owner deleting the achievement', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: 1,
      });

      await expect(service.remove(mediaUser, 5)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.department_achievements.delete).not.toHaveBeenCalled();
    });
  });

  describe('addMedia', () => {
    it('assigns the next sequence_no after the current max', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: 1,
      });
      mockPrisma.achievement_media.aggregate.mockResolvedValue({
        _max: { sequence_no: 3 },
      });
      mockPrisma.achievement_media.create.mockResolvedValue({ id: 1 });

      await service.addMedia(secretaryUser, 5, {
        media_type: 'photo' as any,
        media_url: 'https://x.com/c.jpg',
      });

      expect(mockPrisma.achievement_media.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ sequence_no: 4 }),
      });
    });
  });

  describe('removeMedia', () => {
    it('404s when the media belongs to a different achievement', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: 1,
      });
      mockPrisma.achievement_media.findUnique.mockResolvedValue({
        id: 1,
        achievement_id: 999,
      });

      await expect(
        service.removeMedia(secretaryUser, 5, 1),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.achievement_media.delete).not.toHaveBeenCalled();
    });
  });

  describe('comments', () => {
    it('lets any authenticated user comment (no ownership check on create)', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: 1,
      });
      mockPrisma.achievement_comments.create.mockResolvedValue({ id: 1 });

      await service.addComment(mediaUser, 5, { comment_text: 'Congrats!' });

      expect(mockPrisma.achievement_comments.create).toHaveBeenCalledWith({
        data: {
          achievement_id: 5,
          commented_by_user_id: 2,
          comment_text: 'Congrats!',
        },
      });
    });

    it('403s deleting someone else\'s comment', async () => {
      mockPrisma.achievement_comments.findUnique.mockResolvedValue({
        id: 1,
        achievement_id: 5,
        commented_by_user_id: 2,
      });

      await expect(
        service.removeComment(secretaryUser, 5, 1),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.achievement_comments.delete).not.toHaveBeenCalled();
    });

    it('allows admin to delete someone else\'s comment', async () => {
      mockPrisma.achievement_comments.findUnique.mockResolvedValue({
        id: 1,
        achievement_id: 5,
        commented_by_user_id: 2,
      });
      mockPrisma.achievement_comments.delete.mockResolvedValue({});

      await service.removeComment(adminUser, 5, 1);

      expect(mockPrisma.achievement_comments.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });

    it('allows the author to delete their own comment', async () => {
      mockPrisma.achievement_comments.findUnique.mockResolvedValue({
        id: 1,
        achievement_id: 5,
        commented_by_user_id: 2,
      });
      mockPrisma.achievement_comments.delete.mockResolvedValue({});

      await service.removeComment(mediaUser, 5, 1);

      expect(mockPrisma.achievement_comments.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });
  });
});
