import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateAchievementDto } from './dto/create-achievement.dto';
import { UpdateAchievementDto } from './dto/update-achievement.dto';
import { ListAchievementsQueryDto } from './dto/list-achievements-query.dto';
import { AchievementMediaItemDto } from './dto/achievement-media-item.dto';
import { CreateAchievementCommentDto } from './dto/create-achievement-comment.dto';

const ACHIEVEMENT_INCLUDE = {
  departments: { select: { id: true, name: true } },
  achievement_media: { orderBy: { sequence_no: 'asc' as const } },
  _count: { select: { achievement_comments: true } },
};

/**
 * Department achievement posts (photo/video + description), posted only by
 * Media Room - no other role, not even Admin (narrowed from an earlier
 * design where Secretary/Admin could post too; see AchievementsController's
 * own doc comment). Readable and commentable by any authenticated user of
 * any role - only posting/editing/deleting an achievement or its media is
 * role-gated; comment moderation is by the comment's own author (or Admin;
 * that's a comment-moderation convention, unrelated to who may post).
 */
@Injectable()
export class AchievementsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(user: JwtPayload, dto: CreateAchievementDto) {
    const department = await this.prisma.departments.findUnique({
      where: { id: dto.department_id },
    });
    if (!department) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    return this.prisma.department_achievements.create({
      data: {
        department_id: dto.department_id,
        posted_by_user_id: user.sub,
        title: dto.title,
        description: dto.description,
        achievement_date: dto.achievement_date
          ? new Date(dto.achievement_date)
          : undefined,
        achievement_media: {
          create: dto.media.map((m, idx) => ({
            media_type: m.media_type,
            media_url: m.media_url,
            thumbnail_url: m.thumbnail_url,
            sequence_no: idx + 1,
          })),
        },
      },
      include: ACHIEVEMENT_INCLUDE,
    });
  }

  async findAll(dto: ListAchievementsQueryDto) {
    const where: Record<string, unknown> = {};
    if (dto.department_id) where.department_id = dto.department_id;

    const [data, total] = await Promise.all([
      this.prisma.department_achievements.findMany({
        where,
        skip: dto.skip,
        take: dto.limit,
        orderBy: { created_at: 'desc' },
        include: ACHIEVEMENT_INCLUDE,
      }),
      this.prisma.department_achievements.count({ where }),
    ]);

    return paginate(data, total, dto);
  }

  async findOne(id: number) {
    const achievement = await this.prisma.department_achievements.findUnique({
      where: { id },
      include: {
        departments: { select: { id: true, name: true } },
        achievement_media: { orderBy: { sequence_no: 'asc' } },
        achievement_comments: { orderBy: { created_at: 'desc' } },
      },
    });
    if (!achievement) {
      throw new NotFoundException({
        message: `Achievement ${id} not found`,
        errorCode: 'ACHIEVEMENT_NOT_FOUND',
      });
    }

    const displays = await this.resolveCommenterDisplays(
      achievement.achievement_comments.map((c) => c.commented_by_user_id),
    );

    return {
      ...achievement,
      achievement_comments: achievement.achievement_comments.map((comment) => ({
        ...comment,
        commenter: displays.get(comment.commented_by_user_id) ?? null,
      })),
    };
  }

  async update(user: JwtPayload, id: number, dto: UpdateAchievementDto) {
    const achievement = await this.findOrThrow(id);
    this.assertOwner(user, achievement);

    return this.prisma.department_achievements.update({
      where: { id },
      data: {
        title: dto.title,
        description: dto.description,
        achievement_date: dto.achievement_date
          ? new Date(dto.achievement_date)
          : undefined,
      },
      include: ACHIEVEMENT_INCLUDE,
    });
  }

  async remove(user: JwtPayload, id: number) {
    const achievement = await this.findOrThrow(id);
    this.assertOwner(user, achievement);

    // Cascades to achievement_media and achievement_comments (onDelete: Cascade in schema).
    await this.prisma.department_achievements.delete({ where: { id } });
    return { id };
  }

  // ───────────────────────────── Media ─────────────────────────────

  async addMedia(
    user: JwtPayload,
    achievementId: number,
    dto: AchievementMediaItemDto,
  ) {
    const achievement = await this.findOrThrow(achievementId);
    this.assertOwner(user, achievement);

    const maxSeq = await this.prisma.achievement_media.aggregate({
      where: { achievement_id: achievementId },
      _max: { sequence_no: true },
    });

    return this.prisma.achievement_media.create({
      data: {
        achievement_id: achievementId,
        media_type: dto.media_type,
        media_url: dto.media_url,
        thumbnail_url: dto.thumbnail_url,
        sequence_no: (maxSeq._max.sequence_no ?? 0) + 1,
      },
    });
  }

  async removeMedia(user: JwtPayload, achievementId: number, mediaId: number) {
    const achievement = await this.findOrThrow(achievementId);
    this.assertOwner(user, achievement);

    const media = await this.prisma.achievement_media.findUnique({
      where: { id: mediaId },
    });
    if (!media || media.achievement_id !== achievementId) {
      throw new NotFoundException({
        message: `Media ${mediaId} not found on this achievement`,
        errorCode: 'MEDIA_NOT_FOUND',
      });
    }

    await this.prisma.achievement_media.delete({ where: { id: mediaId } });
    return { id: mediaId };
  }

  // ───────────────────────────── Comments ─────────────────────────────

  async addComment(
    user: JwtPayload,
    achievementId: number,
    dto: CreateAchievementCommentDto,
  ) {
    await this.findOrThrow(achievementId);

    const comment = await this.prisma.achievement_comments.create({
      data: {
        achievement_id: achievementId,
        commented_by_user_id: user.sub,
        comment_text: dto.comment_text,
      },
    });

    const displays = await this.resolveCommenterDisplays([user.sub]);
    return { ...comment, commenter: displays.get(user.sub) ?? null };
  }

  async removeComment(
    user: JwtPayload,
    achievementId: number,
    commentId: number,
  ) {
    const comment = await this.prisma.achievement_comments.findUnique({
      where: { id: commentId },
    });
    if (!comment || comment.achievement_id !== achievementId) {
      throw new NotFoundException({
        message: `Comment ${commentId} not found on this achievement`,
        errorCode: 'COMMENT_NOT_FOUND',
      });
    }

    if (
      comment.commented_by_user_id !== user.sub &&
      user.role !== ROLES.ADMIN
    ) {
      throw new ForbiddenException({
        message: 'You can only delete your own comment',
        errorCode: 'NOT_COMMENT_OWNER',
      });
    }

    await this.prisma.achievement_comments.delete({ where: { id: commentId } });
    return { id: commentId };
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  private async findOrThrow(id: number) {
    const achievement = await this.prisma.department_achievements.findUnique({
      where: { id },
    });
    if (!achievement) {
      throw new NotFoundException({
        message: `Achievement ${id} not found`,
        errorCode: 'ACHIEVEMENT_NOT_FOUND',
      });
    }
    return achievement;
  }

  /**
   * Media Room only reaches these methods at all (route-level @Roles), but
   * that doesn't mean any Media Room account may touch any other Media
   * Room account's post - still scoped to whoever actually posted it, with
   * no role-based override (Admin included).
   */
  private assertOwner(user: JwtPayload, achievement: { posted_by_user_id: number }) {
    if (achievement.posted_by_user_id !== user.sub) {
      throw new ForbiddenException({
        message: 'You can only modify your own achievement post',
        errorCode: 'NOT_POST_OWNER',
      });
    }
  }

  // ───────────────────────────── Commenter display ─────────────────────────────

  /**
   * Resolves {name, department} for a batch of commenter user ids in one
   * round trip, for the comments list on a single achievement.
   *
   * "Department" only has a real meaning for Faculty/HoD (faculty.
   * departments) and Students (via their course's department) - every
   * other role (Parent, HR, Finance, Library, ...) has no department
   * anywhere in the schema, so their role's own roles.description (a
   * human label already in the DB, e.g. "Parent / Guardian", "HR & Payroll
   * Management") stands in for it instead.
   *
   * "Name" only has a real stored value for Faculty (first_name/last_name
   * columns) and Students with a soa_applications row - everyone else,
   * including every no-department role above, has no name anywhere either,
   * so users.email is the fallback, same convention already used for a
   * student with no soa_applications row.
   */
  private async resolveCommenterDisplays(
    userIds: number[],
  ): Promise<Map<number, { name: string; department: string }>> {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) return new Map();

    const users = await this.prisma.users.findMany({
      where: { id: { in: uniqueIds } },
      select: {
        id: true,
        email: true,
        roles: { select: { name: true, description: true } },
        faculty: {
          select: {
            first_name: true,
            last_name: true,
            departments: { select: { name: true } },
          },
        },
        students: {
          select: {
            soa_applications: { select: { first_name: true, last_name: true } },
            courses: { select: { departments: { select: { name: true } } } },
          },
        },
      },
    });

    const map = new Map<number, { name: string; department: string }>();
    for (const user of users) {
      map.set(user.id, this.toCommenterDisplay(user));
    }
    return map;
  }

  private toCommenterDisplay(user: {
    email: string;
    roles: { name: string; description: string | null };
    faculty: { first_name: string; last_name: string; departments: { name: string } } | null;
    students: {
      soa_applications: { first_name: string; last_name: string | null } | null;
      courses: { departments: { name: string } } | null;
    } | null;
  }): { name: string; department: string } {
    const roleLabel = user.roles.description ?? user.roles.name;

    if (user.faculty) {
      return {
        name: `${user.faculty.first_name} ${user.faculty.last_name}`,
        department: user.faculty.departments.name,
      };
    }

    if (user.students) {
      const { soa_applications, courses } = user.students;
      const name = soa_applications
        ? [soa_applications.first_name, soa_applications.last_name].filter(Boolean).join(' ')
        : user.email;
      return {
        name,
        department: courses?.departments.name ?? roleLabel,
      };
    }

    // No profile row at all (Parent, HR, Finance, Library, ... - see this
    // method's own doc comment).
    return { name: user.email, department: roleLabel };
  }
}
