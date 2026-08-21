import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateMeetingDto } from './dto/create-meeting.dto';

const MEETING_SELECT = {
  id: true,
  title: true,
  meeting_at: true,
  venue: true,
  invitee_count: true,
  mom_status: true,
  mom_text: true,
  created_at: true,
  departments: { select: { id: true, name: true, code: true } },
  users_department_meetings_chair_user_idTousers: { select: { id: true, email: true } },
  meeting_action_items: { select: { id: true, label: true, done: true } },
} as const;

function toResponse(row: {
  id: number;
  title: string;
  meeting_at: Date;
  venue: string | null;
  invitee_count: number;
  mom_status: string;
  mom_text: string | null;
  created_at: Date;
  departments: { id: number; name: string; code: string };
  users_department_meetings_chair_user_idTousers: { id: number; email: string } | null;
  meeting_action_items: { id: number; label: string; done: boolean }[];
}) {
  return {
    id: row.id,
    title: row.title,
    meeting_at: row.meeting_at,
    venue: row.venue,
    invitee_count: row.invitee_count,
    mom_status: row.mom_status,
    mom_text: row.mom_text,
    created_at: row.created_at,
    department: row.departments,
    chair: row.users_department_meetings_chair_user_idTousers,
    action_items: row.meeting_action_items,
  };
}

/** Meeting & MoM Management — Secretary Portal screen. Institution-wide
 * for Secretary/Admin/Principal (no secretary→department table exists). */
@Injectable()
export class MeetingsService {
  private readonly logger = new Logger(MeetingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateMeetingDto, userId: number) {
    const department = await this.prisma.departments.findUnique({ where: { id: dto.department_id } });
    if (!department) {
      throw new NotFoundException({ message: 'Department not found', errorCode: 'DEPARTMENT_NOT_FOUND' });
    }
    try {
      const row = await this.prisma.department_meetings.create({
        data: {
          department_id: dto.department_id,
          title: dto.title,
          meeting_at: new Date(dto.meeting_at),
          venue: dto.venue,
          chair_user_id: dto.chair_user_id,
          invitee_count: dto.invitee_count ?? 0,
          mom_status: 'scheduled',
          created_by_user_id: userId,
        },
        select: MEETING_SELECT,
      });
      return toResponse(row);
    } catch (err) {
      this.logger.error('DB error creating meeting', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async findAll(departmentId?: number) {
    const rows = await this.prisma.department_meetings.findMany({
      where: departmentId !== undefined ? { department_id: departmentId } : undefined,
      orderBy: { meeting_at: 'desc' },
      select: MEETING_SELECT,
    });
    return rows.map(toResponse);
  }

  async updateMom(id: number, momText: string) {
    const existing = await this.prisma.department_meetings.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Meeting not found', errorCode: 'MEETING_NOT_FOUND' });
    }
    const row = await this.prisma.department_meetings.update({
      where: { id },
      data: { mom_text: momText, mom_status: momText.trim() ? 'recorded' : 'scheduled' },
      select: MEETING_SELECT,
    });
    return toResponse(row);
  }

  async circulate(id: number) {
    const existing = await this.prisma.department_meetings.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Meeting not found', errorCode: 'MEETING_NOT_FOUND' });
    }
    if (!existing.mom_text) {
      throw new InternalServerErrorException({ message: 'Record the minutes before circulating.', errorCode: 'MOM_NOT_RECORDED' });
    }
    const row = await this.prisma.department_meetings.update({
      where: { id },
      data: { mom_status: 'circulated' },
      select: MEETING_SELECT,
    });
    return toResponse(row);
  }

  async addActionItem(meetingId: number, label: string) {
    const existing = await this.prisma.department_meetings.findUnique({ where: { id: meetingId } });
    if (!existing) {
      throw new NotFoundException({ message: 'Meeting not found', errorCode: 'MEETING_NOT_FOUND' });
    }
    await this.prisma.meeting_action_items.create({ data: { meeting_id: meetingId, label } });
    const row = await this.prisma.department_meetings.findUnique({ where: { id: meetingId }, select: MEETING_SELECT });
    return toResponse(row!);
  }

  async toggleActionItem(meetingId: number, itemId: number) {
    const item = await this.prisma.meeting_action_items.findUnique({ where: { id: itemId } });
    if (!item || item.meeting_id !== meetingId) {
      throw new NotFoundException({ message: 'Action item not found', errorCode: 'ACTION_ITEM_NOT_FOUND' });
    }
    await this.prisma.meeting_action_items.update({ where: { id: itemId }, data: { done: !item.done } });
    const row = await this.prisma.department_meetings.findUnique({ where: { id: meetingId }, select: MEETING_SELECT });
    return toResponse(row!);
  }
}
