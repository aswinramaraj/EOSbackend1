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
 * Department achievement posts (photo/video + description), posted by the
 * Secretary or Media Room. Readable and commentable by any authenticated
 * user — only posting/editing/deleting an achievement or its media is
 * role-gated; comment moderation is by the comment's own author (or Admin).
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
    return achievement;
  }

  async update(user: JwtPayload, id: number, dto: UpdateAchievementDto) {
    const achievement = await this.findOrThrow(id);
    this.assertOwnerOrAdmin(user, achievement);

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
    this.assertOwnerOrAdmin(user, achievement);

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
    this.assertOwnerOrAdmin(user, achievement);

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
    this.assertOwnerOrAdmin(user, achievement);

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

    return this.prisma.achievement_comments.create({
      data: {
        achievement_id: achievementId,
        commented_by_user_id: user.sub,
        comment_text: dto.comment_text,
      },
    });
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

    if (comment.commented_by_user_id !== user.sub && user.role !== ROLES.ADMIN) {
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

  private assertOwnerOrAdmin(
    user: JwtPayload,
    achievement: { posted_by_user_id: number },
  ) {
    if (achievement.posted_by_user_id !== user.sub && user.role !== ROLES.ADMIN) {
      throw new ForbiddenException({
        message: 'You can only modify your own achievement post',
        errorCode: 'NOT_POST_OWNER',
      });
    }
  }
}
