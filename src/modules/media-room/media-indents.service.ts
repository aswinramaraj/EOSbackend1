import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateIndentDto, UpdateIndentDto } from './dto/media-indent.dto';
import { dateOnly, instant, money, readyList } from './serialize';

const INDENT_SELECT = {
  id: true,
  requested_by_user_id: true,
  title: true,
  indent_type: true,
  quantity: true,
  estimated_cost: true,
  needed_by: true,
  budget_head: true,
  justification: true,
  status: true,
  created_at: true,
  resolved_at: true,
  resolution_notes: true,
} as const;

interface IndentRow {
  id: number;
  requested_by_user_id: number;
  title: string;
  indent_type: string;
  quantity: number;
  estimated_cost: { toString(): string } | null;
  needed_by: Date | null;
  budget_head: string;
  justification: string | null;
  status: string;
  created_at: Date;
  resolved_at: Date | null;
  resolution_notes: string | null;
}

function hasCode(err: unknown, code: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === code
  );
}

@Injectable()
export class MediaIndentsService {
  private readonly logger = new Logger(MediaIndentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private shape(row: IndentRow) {
    return {
      id: row.id,
      requested_by_user_id: row.requested_by_user_id,
      title: row.title,
      indent_type: row.indent_type,
      quantity: row.quantity,
      estimated_cost: money(row.estimated_cost),
      needed_by: dateOnly(row.needed_by),
      budget_head: row.budget_head,
      justification: row.justification,
      status: row.status,
      created_at: instant(row.created_at),
      resolved_at: instant(row.resolved_at),
      resolution_notes: row.resolution_notes,
    };
  }

  /**
   * GET /me/media-indents
   *
   * The Media Room runs a single shared indent queue, so every row is listed
   * rather than only the caller's own — the tab exists to see what the whole
   * team has raised and what is still awaiting a decision.
   */
  async list() {
    const rows = await this.prisma.media_indents.findMany({
      select: INDENT_SELECT,
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
    });
    return readyList(rows.map((r) => this.shape(r)));
  }

  /** POST /me/media-indents */
  async create(dto: CreateIndentDto, userId: number) {
    try {
      const row = await this.prisma.media_indents.create({
        data: {
          requested_by_user_id: userId,
          title: dto.title,
          indent_type: dto.indent_type,
          quantity: dto.quantity,
          estimated_cost: dto.estimated_cost,
          needed_by: dto.needed_by
            ? new Date(dto.needed_by + 'T00:00:00.000Z')
            : undefined,
          budget_head: dto.budget_head,
          justification: dto.justification,
        },
        select: INDENT_SELECT,
      });
      this.logger.log('Media indent created: id=' + row.id + ' by user=' + userId);
      return this.shape(row);
    } catch (err) {
      this.logger.error('DB error creating media indent', err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /me/media-indents/:id — status transition.
   *
   * `resolved_at` is stamped here rather than accepted from the client so the
   * recorded decision time cannot be back-dated, and is cleared if an indent
   * is moved back to pending so a stale timestamp never outlives its decision.
   */
  async updateStatus(id: number, dto: UpdateIndentDto, userId: number) {
    try {
      const row = await this.prisma.media_indents.update({
        where: { id },
        data: {
          status: dto.status,
          resolution_notes: dto.resolution_notes,
          resolved_at: dto.status === 'pending' ? null : new Date(),
        },
        select: INDENT_SELECT,
      });
      this.logger.log(
        'Media indent ' +
          id +
          ' set to ' +
          dto.status +
          ' by user=' +
          userId,
      );
      return this.shape(row);
    } catch (err) {
      if (hasCode(err, 'P2025')) {
        throw new NotFoundException({
          message: 'Indent not found',
          errorCode: 'NOT_FOUND',
        });
      }
      this.logger.error('DB error updating media indent #' + id, err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /me/media-indents/:id
   *
   * Withdrawing is limited to the person who raised the indent (an admin may
   * remove any), so one team member cannot quietly erase another's request
   * from the shared queue.
   */
  async remove(id: number, user: JwtPayload) {
    const existing = await this.prisma.media_indents.findUnique({
      where: { id },
      select: { id: true, requested_by_user_id: true },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Indent not found',
        errorCode: 'NOT_FOUND',
      });
    }
    if (
      existing.requested_by_user_id !== user.sub &&
      user.role !== ROLES.ADMIN
    ) {
      throw new ForbiddenException({
        message: 'You can only withdraw indents you raised',
        errorCode: 'FORBIDDEN',
      });
    }

    try {
      await this.prisma.media_indents.delete({ where: { id } });
      this.logger.log('Media indent deleted: id=' + id + ' by user=' + user.sub);
      return { message: 'Indent deleted successfully' };
    } catch (err) {
      if (hasCode(err, 'P2025')) {
        throw new NotFoundException({
          message: 'Indent not found',
          errorCode: 'NOT_FOUND',
        });
      }
      this.logger.error('DB error deleting media indent #' + id, err as Error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
