import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { CreateTransportNoticeDto } from './dto/create-transport-notice.dto';

interface NoticeRow {
  id: number;
  tag: string;
  title: string;
  created_at: Date;
}

/**
 * Transport office noticeboard — backed by `transport_notices`, a table that
 * doesn't exist in the base schema (see the SQL handed to the DB owner
 * alongside this module). Every call here 404s with a clear message until
 * that table is created, rather than silently no-op-ing.
 */
@Injectable()
export class TransportNoticesService {
  private readonly logger = new Logger(TransportNoticesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    try {
      const rows = await this.prisma.$queryRaw<NoticeRow[]>(Prisma.sql`
        SELECT id, tag, title, created_at FROM transport_notices ORDER BY created_at DESC LIMIT 20
      `);
      return rows;
    } catch (err) {
      this.rethrow(err);
    }
  }

  async create(dto: CreateTransportNoticeDto, userId: number) {
    try {
      const rows = await this.prisma.$queryRaw<NoticeRow[]>(Prisma.sql`
        INSERT INTO transport_notices (tag, title, posted_by_user_id)
        VALUES (${dto.tag}, ${dto.title}, ${userId})
        RETURNING id, tag, title, created_at
      `);
      this.logger.log(`Transport notice created: id=${rows[0]?.id} by user=${userId}`);
      return rows[0];
    } catch (err) {
      this.rethrow(err);
    }
  }

  /** Postgres 42P01 = undefined_table — surfaces as a clear 404, not a generic 500. */
  private rethrow(err: unknown): never {
    const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: string }).code : undefined;
    if (code === '42P01') {
      throw new NotFoundException({
        message: 'The transport_notices table has not been created yet — see the migration SQL for this module.',
        errorCode: 'TRANSPORT_NOTICES_TABLE_MISSING',
      });
    }
    this.logger.error('DB error in transport notices', err);
    throw new InternalServerErrorException({
      message: 'Something went wrong. Please try again.',
      errorCode: 'INTERNAL_ERROR',
    });
  }
}
