import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

/**
 * Comments on an announcement — the discussion thread under a published post,
 * used by the Media Room's publishing screen.
 *
 * `announcement_comments` already existed with rows in it but had no routes at
 * all, which is why the thread never loaded. Replies are supported through
 * `parent_comment_id`; the table cascades children when a parent goes, so a
 * deleted comment takes its replies with it rather than orphaning them.
 */

const COMMENT_SELECT = {
  id: true,
  announcement_id: true,
  commented_by_user_id: true,
  comment_text: true,
  parent_comment_id: true,
  created_at: true,
  users: {
    select: {
      email: true,
      faculty: { select: { first_name: true, last_name: true } },
      non_teaching_staff: { select: { first_name: true, last_name: true } },
    },
  },
} as const;

interface CommenterRow {
  email: string;
  faculty: { first_name: string; last_name: string } | null;
  non_teaching_staff: { first_name: string; last_name: string | null }[];
}

interface CommentRow {
  id: number;
  announcement_id: number;
  commented_by_user_id: number;
  comment_text: string;
  parent_comment_id: number | null;
  created_at: Date;
  users: CommenterRow;
}

/**
 * Same faculty-then-non_teaching_staff-then-email fallback the rest of this
 * codebase uses — `users` holds no name of its own.
 */
function resolveCommenterName(u: CommenterRow): string {
  if (u.faculty) return `${u.faculty.first_name} ${u.faculty.last_name}`;
  const staff = u.non_teaching_staff[0];
  if (staff) {
    return staff.last_name
      ? `${staff.first_name} ${staff.last_name}`
      : staff.first_name;
  }
  return u.email;
}

@Injectable()
export class AnnouncementCommentsService {
  private readonly logger = new Logger(AnnouncementCommentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private shape(row: CommentRow) {
    return {
      id: row.id,
      announcement_id: row.announcement_id,
      commented_by_user_id: row.commented_by_user_id,
      comment_text: row.comment_text,
      parent_comment_id: row.parent_comment_id,
      created_at: row.created_at.toISOString(),
      commenter_name: resolveCommenterName(row.users),
    };
  }

  private async assertAnnouncementExists(announcementId: number): Promise<void> {
    const exists = await this.prisma.announcements.count({
      where: { id: announcementId },
    });
    if (exists === 0) {
      throw new NotFoundException({
        message: 'Announcement not found',
        errorCode: 'ANNOUNCEMENT_NOT_FOUND',
      });
    }
  }

  /** GET /announcements/:id/comments — oldest first, so a thread reads in order. */
  async findAll(announcementId: number) {
    await this.assertAnnouncementExists(announcementId);

    try {
      const rows = await this.prisma.announcement_comments.findMany({
        where: { announcement_id: announcementId },
        select: COMMENT_SELECT,
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        take: 500,
      });
      return rows.map((r) => this.shape(r));
    } catch (err) {
      this.logger.error('DB error loading announcement comments', err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** POST /announcements/:id/comments */
  async create(
    announcementId: number,
    dto: { comment_text: string; parent_comment_id?: number },
    userId: number,
  ) {
    await this.assertAnnouncementExists(announcementId);

    // A reply must belong to the same announcement, or a comment could be
    // grafted onto an unrelated thread.
    if (dto.parent_comment_id != null) {
      const parent = await this.prisma.announcement_comments.findUnique({
        where: { id: dto.parent_comment_id },
        select: { announcement_id: true },
      });
      if (!parent) {
        throw new NotFoundException({
          message: 'The comment being replied to no longer exists',
          errorCode: 'PARENT_COMMENT_NOT_FOUND',
        });
      }
      if (parent.announcement_id !== announcementId) {
        throw new BadRequestException({
          message: 'That comment belongs to a different announcement',
          errorCode: 'PARENT_COMMENT_MISMATCH',
        });
      }
    }

    try {
      const row = await this.prisma.announcement_comments.create({
        data: {
          announcement_id: announcementId,
          commented_by_user_id: userId,
          comment_text: dto.comment_text,
          parent_comment_id: dto.parent_comment_id,
        },
        select: COMMENT_SELECT,
      });
      this.logger.log(
        `Comment ${row.id} added to announcement ${announcementId} by user=${userId}`,
      );
      return this.shape(row);
    } catch (err) {
      this.logger.error('DB error creating announcement comment', err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /announcements/:id/comments/:commentId
   *
   * The comment's author may remove it. So may the person who posted the
   * announcement — they moderate their own thread — and Admin. Anyone else is
   * refused, so one commenter cannot delete another's remark.
   */
  async remove(announcementId: number, commentId: number, user: JwtPayload) {
    const comment = await this.prisma.announcement_comments.findUnique({
      where: { id: commentId },
      select: {
        id: true,
        announcement_id: true,
        commented_by_user_id: true,
        announcements: { select: { posted_by_user_id: true } },
      },
    });

    if (!comment || comment.announcement_id !== announcementId) {
      throw new NotFoundException({
        message: 'Comment not found',
        errorCode: 'COMMENT_NOT_FOUND',
      });
    }

    const isAuthor = comment.commented_by_user_id === user.sub;
    const isPoster = comment.announcements?.posted_by_user_id === user.sub;
    const isAdmin = user.role === ROLES.ADMIN;

    if (!isAuthor && !isPoster && !isAdmin) {
      throw new ForbiddenException({
        message: 'You can only delete your own comments',
        errorCode: 'FORBIDDEN',
      });
    }

    try {
      // Replies cascade with the parent (FK is ON DELETE CASCADE), so a thread
      // never keeps orphaned children.
      await this.prisma.announcement_comments.delete({ where: { id: commentId } });
      this.logger.log(`Comment ${commentId} deleted by user=${user.sub}`);
      return { id: commentId, message: 'Comment deleted successfully' };
    } catch (err) {
      this.logger.error('DB error deleting announcement comment', err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
