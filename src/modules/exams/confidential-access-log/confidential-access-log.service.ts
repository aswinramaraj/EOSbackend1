import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListConfidentialEventsQueryDto } from './dto/list-confidential-events-query.dto';
import { CreateConfidentialEventDto } from './dto/create-confidential-event.dto';

const USER_SELECT = { id: true, email: true } as const;

@Injectable()
export class ConfidentialAccessLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The design shows a real name + role ("Dr. R. Anitha · Controller of
   * Examinations") for each person, but `users` itself carries no display
   * name — only email (same real constraint the COE topbar already lives
   * with, see CoeShell). Best-effort real resolution: if this user account
   * also has a faculty profile, use that real name + designation; otherwise
   * fall back to the email, honestly, rather than inventing a name.
   */
  private async resolveActors(userIds: number[]) {
    if (userIds.length === 0) return new Map<number, { name: string; role: string | null }>();
    const faculty = await this.prisma.faculty.findMany({
      where: { user_id: { in: userIds } },
      select: { user_id: true, prefix: true, first_name: true, last_name: true, designation: true },
    });
    return new Map(
      faculty.map((f) => [f.user_id, { name: [f.prefix, f.first_name, f.last_name].filter(Boolean).join(' '), role: f.designation }]),
    );
  }

  async findAll(query: ListConfidentialEventsQueryDto) {
    const where: Prisma.confidential_access_eventsWhereInput = {};
    if (query.event_type) where.event_type = query.event_type;
    if (query.person_user_id) where.person_user_id = query.person_user_id;
    if (query.search) {
      where.OR = [
        { object_description: { contains: query.search, mode: 'insensitive' } },
        { witness_description: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const rows = await this.prisma.confidential_access_events.findMany({
      where,
      include: {
        users_confidential_access_events_person_user_idTousers: { select: USER_SELECT },
        users_confidential_access_events_witness_user_idTousers: { select: USER_SELECT },
      },
      orderBy: { occurred_at: 'desc' },
    });

    const userIds = [...new Set(rows.flatMap((r) => [r.person_user_id, r.witness_user_id].filter((id): id is number => id != null)))];
    const actors = await this.resolveActors(userIds);

    return rows.map((r) => ({
      ...r,
      person: actors.get(r.person_user_id) ?? { name: r.users_confidential_access_events_person_user_idTousers.email, role: null },
      witness:
        r.witness_user_id != null
          ? (actors.get(r.witness_user_id) ?? { name: r.users_confidential_access_events_witness_user_idTousers!.email, role: null })
          : null,
    }));
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
