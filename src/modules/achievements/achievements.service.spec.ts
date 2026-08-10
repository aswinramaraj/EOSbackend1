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

  // Only Media Room reaches this service's write methods at all (route-level
  // @Roles(ROLES.MEDIA_ROOM) on the controller) - these two both carry that
  // role, distinguished only by their own user id, to test ownership
  // (not role) is what actually gates update/remove/addMedia/removeMedia.
  const mediaUserA = { sub: 2, email: 'media-a@eos.test', role: 'media_room', roleId: 2 };
  const mediaUserB = { sub: 3, email: 'media-b@eos.test', role: 'media_room', roleId: 3 };
  const adminUser = { sub: 9, email: 'admin@eos.test', role: 'admin', roleId: 9 };
  // Any authenticated role may comment - these three exercise the three
  // distinct branches resolveCommenterDisplays can take.
  const facultyUser = { sub: 20, email: 'faculty@eos.test', role: 'faculty', roleId: 20 };
  const studentUser = { sub: 21, email: 'student@eos.test', role: 'student', roleId: 21 };
  const parentUser = { sub: 22, email: 'parent@eos.test', role: 'parent', roleId: 22 };

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
      users: { findMany: jest.fn().mockResolvedValue([]) },
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
        service.create(mediaUserA, {
          department_id: 99,
          title: 'Won a hackathon',
          media: [{ media_type: 'photo', media_url: 'https://x.com/a.jpg' }],
        } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('assigns sequence numbers 1..n to media in submission order', async () => {
      mockPrisma.departments.findUnique.mockResolvedValue({ id: 1 });
      mockPrisma.department_achievements.create.mockResolvedValue({ id: 10 });

      await service.create(mediaUserA, {
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

  describe('update/remove — ownership (Media Room only reaches here at all; no role override)', () => {
    it('403s when a different Media Room account (not the poster) tries to update', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: mediaUserA.sub,
      });

      await expect(
        service.update(mediaUserB, 5, { title: 'Edited' }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.department_achievements.update).not.toHaveBeenCalled();
    });

    it('allows the original poster to update their own post', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: mediaUserA.sub,
      });
      mockPrisma.department_achievements.update.mockResolvedValue({ id: 5 });

      await service.update(mediaUserA, 5, { title: 'Edited' });

      expect(mockPrisma.department_achievements.update).toHaveBeenCalled();
    });

    it("403s Admin trying to update someone else's post - no role override anymore", async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: mediaUserA.sub,
      });

      await expect(
        service.update(adminUser, 5, { title: 'Edited by admin' }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.department_achievements.update).not.toHaveBeenCalled();
    });

    it('403s a non-owner deleting the achievement', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: mediaUserA.sub,
      });

      await expect(service.remove(mediaUserB, 5)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.department_achievements.delete).not.toHaveBeenCalled();
    });
  });

  describe('addMedia', () => {
    it('assigns the next sequence_no after the current max', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: mediaUserA.sub,
      });
      mockPrisma.achievement_media.aggregate.mockResolvedValue({
        _max: { sequence_no: 3 },
      });
      mockPrisma.achievement_media.create.mockResolvedValue({ id: 1 });

      await service.addMedia(mediaUserA, 5, {
        media_type: 'photo',
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
        posted_by_user_id: mediaUserA.sub,
      });
      mockPrisma.achievement_media.findUnique.mockResolvedValue({
        id: 1,
        achievement_id: 999,
      });

      await expect(service.removeMedia(mediaUserA, 5, 1)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.achievement_media.delete).not.toHaveBeenCalled();
    });
  });

  describe('comments', () => {
    it('lets any authenticated user comment (no ownership/role check on create)', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: mediaUserA.sub,
      });
      mockPrisma.achievement_comments.create.mockResolvedValue({ id: 1 });
      mockPrisma.users.findMany.mockResolvedValue([
        {
          id: studentUser.sub,
          email: studentUser.email,
          roles: { name: 'student', description: 'Student' },
          faculty: null,
          students: {
            soa_applications: { first_name: 'Ananya', last_name: 'Rao' },
            courses: { departments: { name: 'Computer Science and Engineering' } },
          },
        },
      ]);

      await service.addComment(studentUser, 5, { comment_text: 'Congrats!' });

      expect(mockPrisma.achievement_comments.create).toHaveBeenCalledWith({
        data: {
          achievement_id: 5,
          commented_by_user_id: studentUser.sub,
          comment_text: 'Congrats!',
        },
      });
    });

    it("attaches {name, department} for a Faculty commenter, from faculty's own columns", async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: mediaUserA.sub,
      });
      mockPrisma.achievement_comments.create.mockResolvedValue({ id: 1 });
      mockPrisma.users.findMany.mockResolvedValue([
        {
          id: facultyUser.sub,
          email: facultyUser.email,
          roles: { name: 'faculty', description: 'Teaching Faculty' },
          faculty: {
            first_name: 'Vasanthi',
            last_name: 'S',
            departments: { name: 'Electronics and Communication Engineering' },
          },
          students: null,
        },
      ]);

      const result = await service.addComment(facultyUser, 5, { comment_text: 'Well done' });

      expect(result.commenter).toEqual({
        name: 'Vasanthi S',
        department: 'Electronics and Communication Engineering',
      });
    });

    it('attaches {name, department} for a Student commenter with a soa_applications row', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: mediaUserA.sub,
      });
      mockPrisma.achievement_comments.create.mockResolvedValue({ id: 1 });
      mockPrisma.users.findMany.mockResolvedValue([
        {
          id: studentUser.sub,
          email: studentUser.email,
          roles: { name: 'student', description: 'Student' },
          faculty: null,
          students: {
            soa_applications: { first_name: 'Ananya', last_name: 'Rao' },
            courses: { departments: { name: 'Computer Science and Engineering' } },
          },
        },
      ]);

      const result = await service.addComment(studentUser, 5, { comment_text: 'Congrats!' });

      expect(result.commenter).toEqual({
        name: 'Ananya Rao',
        department: 'Computer Science and Engineering',
      });
    });

    it('falls back to email for a Student with no soa_applications row', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: mediaUserA.sub,
      });
      mockPrisma.achievement_comments.create.mockResolvedValue({ id: 1 });
      mockPrisma.users.findMany.mockResolvedValue([
        {
          id: studentUser.sub,
          email: studentUser.email,
          roles: { name: 'student', description: 'Student' },
          faculty: null,
          students: {
            soa_applications: null,
            courses: { departments: { name: 'Computer Science and Engineering' } },
          },
        },
      ]);

      const result = await service.addComment(studentUser, 5, { comment_text: 'Congrats!' });

      expect(result.commenter).toEqual({
        name: studentUser.email,
        department: 'Computer Science and Engineering',
      });
    });

    it('falls back to email + role description for a role with no profile row at all (e.g. Parent)', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: mediaUserA.sub,
      });
      mockPrisma.achievement_comments.create.mockResolvedValue({ id: 1 });
      mockPrisma.users.findMany.mockResolvedValue([
        {
          id: parentUser.sub,
          email: parentUser.email,
          roles: { name: 'parent', description: 'Parent / Guardian' },
          faculty: null,
          students: null,
        },
      ]);

      const result = await service.addComment(parentUser, 5, { comment_text: 'Proud of you!' });

      expect(result.commenter).toEqual({
        name: parentUser.email,
        department: 'Parent / Guardian',
      });
    });

    it("403s deleting someone else's comment", async () => {
      mockPrisma.achievement_comments.findUnique.mockResolvedValue({
        id: 1,
        achievement_id: 5,
        commented_by_user_id: studentUser.sub,
      });

      await expect(service.removeComment(facultyUser, 5, 1)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.achievement_comments.delete).not.toHaveBeenCalled();
    });

    it("allows admin to delete someone else's comment (comment moderation, unrelated to posting authorization)", async () => {
      mockPrisma.achievement_comments.findUnique.mockResolvedValue({
        id: 1,
        achievement_id: 5,
        commented_by_user_id: studentUser.sub,
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
        commented_by_user_id: studentUser.sub,
      });
      mockPrisma.achievement_comments.delete.mockResolvedValue({});

      await service.removeComment(studentUser, 5, 1);

      expect(mockPrisma.achievement_comments.delete).toHaveBeenCalledWith({
        where: { id: 1 },
      });
    });
  });

  describe('findOne', () => {
    it('attaches a resolved {name, department} to every comment, batched in one users query', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue({
        id: 5,
        posted_by_user_id: mediaUserA.sub,
        achievement_comments: [
          { id: 1, commented_by_user_id: facultyUser.sub, comment_text: 'Great work' },
          { id: 2, commented_by_user_id: parentUser.sub, comment_text: 'So proud' },
        ],
      });
      mockPrisma.users.findMany.mockResolvedValue([
        {
          id: facultyUser.sub,
          email: facultyUser.email,
          roles: { name: 'faculty', description: 'Teaching Faculty' },
          faculty: {
            first_name: 'Vasanthi',
            last_name: 'S',
            departments: { name: 'Electronics and Communication Engineering' },
          },
          students: null,
        },
        {
          id: parentUser.sub,
          email: parentUser.email,
          roles: { name: 'parent', description: 'Parent / Guardian' },
          faculty: null,
          students: null,
        },
      ]);

      const result = await service.findOne(5);

      expect(mockPrisma.users.findMany).toHaveBeenCalledTimes(1);
      expect(result.achievement_comments).toEqual([
        expect.objectContaining({
          id: 1,
          commenter: { name: 'Vasanthi S', department: 'Electronics and Communication Engineering' },
        }),
        expect.objectContaining({
          id: 2,
          commenter: { name: parentUser.email, department: 'Parent / Guardian' },
        }),
      ]);
    });

    it('404s when the achievement does not exist', async () => {
      mockPrisma.department_achievements.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });
});
