import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListConfidentialEventsQueryDto } from './dto/list-confidential-events-query.dto';
import { CreateConfidentialEventDto } from './dto/create-confidential-event.dto';

const USER_SELECT = { id: true, email: true } as const;

@Injectable()
export class ConfidentialAccessLogService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListConfidentialEventsQueryDto) {
    const where: Prisma.confidential_access_eventsWhereInput = {};
    if (query.event_type) where.event_type = query.event_type;
    if (query.search) {
      where.OR = [
        { object_description: { contains: query.search, mode: 'insensitive' } },
        { witness_description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    return this.prisma.confidential_access_events.findMany({
      where,
      include: {
        users_confidential_access_events_person_user_idTousers: { select: USER_SELECT },
        users_confidential_access_events_witness_user_idTousers: { select: USER_SELECT },
      },
      orderBy: { occurred_at: 'desc' },
    });
  }

  async getStats() {
    const [total, strongRoom, sealed, exceptions] = await Promise.all([
      this.prisma.confidential_access_events.count(),
      this.prisma.confidential_access_events.count({ where: { event_type: 'strong_room_entry' } }),
      this.prisma.question_papers.count({ where: { status: 'sealed' } }),
      this.prisma.confidential_access_events.count({ where: { event_type: 'exception' } }),
    ]);

    return { events_logged: total, strong_room_entries: strongRoom, sealed_papers: sealed, exceptions_raised: exceptions };
  }

  async create(dto: CreateConfidentialEventDto, performedByUserId: number) {
    return this.prisma.confidential_access_events.create({
      data: {
        event_type: dto.event_type,
        person_user_id: performedByUserId,
        object_description: dto.object_description,
        witness_user_id: dto.witness_user_id,
        witness_description: dto.witness_description,
        verification_method: dto.verification_method,
        question_paper_id: dto.question_paper_id,
      },
    });
  }
}
