import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { detectMediaRoomSchema } from './media-room-schema.util';
import { CreateIndentDto } from './dto/create-indent.dto';
import { UpdateIndentDto } from './dto/update-indent.dto';

export interface IndentRow {
  id: number;
  requested_by_user_id: number;
  title: string;
  indent_type: string;
  quantity: number;
  estimated_cost: string | null;
  needed_by: Date | null;
  budget_head: string;
  justification: string | null;
  status: string;
  created_at: Date;
  resolved_at: Date | null;
  resolution_notes: string | null;
}

const INDENT_COLUMNS = Prisma.sql`id, requested_by_user_id, title, indent_type, quantity, estimated_cost, needed_by, budget_head, justification, status, created_at, resolved_at, resolution_notes`;

/** Equipment/consumable indents — media_indents (new table, not in schema.prisma). */
@Injectable()
export class MediaRoomIndentsService {
  private readonly logger = new Logger(MediaRoomIndentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    const schema = await detectMediaRoomSchema(this.prisma);
    if (!schema.indents) return { ready: false, data: [] };

    try {
      const rows = await this.prisma.$queryRaw<IndentRow[]>(Prisma.sql`
        SELECT ${INDENT_COLUMNS} FROM media_indents ORDER BY created_at DESC
      `);
      return { ready: true, data: rows };
    } catch (err) {
      this.logger.error('DB error listing media indents', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  private async findOneRaw(id: number): Promise<IndentRow> {
    const rows = await this.prisma.$queryRaw<IndentRow[]>(Prisma.sql`
      SELECT ${INDENT_COLUMNS} FROM media_indents WHERE id = ${id}
    `);
    if (rows.length === 0) throw new NotFoundException({ message: 'Indent not found', errorCode: 'INDENT_NOT_FOUND' });
    return rows[0];
  }

  async create(dto: CreateIndentDto, userId: number) {
    try {
      const status = dto.save_as_draft ? 'draft' : 'pending';
      const rows = await this.prisma.$queryRaw<IndentRow[]>(Prisma.sql`
        INSERT INTO media_indents (requested_by_user_id, title, indent_type, quantity, estimated_cost, needed_by, budget_head, justification, status)
        VALUES (${userId}, ${dto.title}, ${dto.indent_type ?? 'capital_equipment'}, ${dto.quantity ?? 1}, ${dto.estimated_cost ?? null}, ${dto.needed_by ?? null}, ${dto.budget_head ?? 'media_branding'}, ${dto.justification ?? null}, ${status})
        RETURNING ${INDENT_COLUMNS}
      `);
      return rows[0];
    } catch (err) {
      this.logger.error('DB error creating media indent', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async updateStatus(id: number, dto: UpdateIndentDto) {
    await this.findOneRaw(id);
    try {
      const resolved = dto.status !== 'pending';
      const rows = await this.prisma.$queryRaw<IndentRow[]>(Prisma.sql`
        UPDATE media_indents SET
          status = ${dto.status},
          resolution_notes = COALESCE(${dto.resolution_notes ?? null}, resolution_notes),
          resolved_at = CASE WHEN ${resolved} THEN now() ELSE NULL END
        WHERE id = ${id}
        RETURNING ${INDENT_COLUMNS}
      `);
      return rows[0];
    } catch (err) {
      this.logger.error(`DB error updating media indent ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async remove(id: number) {
    await this.findOneRaw(id);
    try {
      await this.prisma.$executeRaw(Prisma.sql`DELETE FROM media_indents WHERE id = ${id}`);
      return { id };
    } catch (err) {
      this.logger.error(`DB error deleting media indent ${id}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
