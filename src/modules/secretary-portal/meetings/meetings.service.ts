import { ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
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

  /** Secretary is always forced to her own department; other roles keep whatever was requested (or none = institution-wide). */
  private async resolveEffectiveDepartmentId(
    user: JwtPayload,
    requested?: number,
  ): Promise<number | undefined> {
    if (user.role !== ROLES.SECRETARY) return requested;
    const staff = await this.prisma.non_teaching_staff.findFirst({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!staff?.department_id) {
      throw new ForbiddenException({
        message: 'No department is assigned to this secretary account',
        errorCode: 'SECRETARY_NO_DEPARTMENT',
      });
    }
    return staff.department_id;
  }

  /** A Secretary may only act on meetings belonging to her own department — other roles are unrestricted. */
  private async assertDepartmentAccess(user: JwtPayload, meetingDepartmentId: number): Promise<void> {
    if (user.role !== ROLES.SECRETARY) return;
    const staff = await this.prisma.non_teaching_staff.findFirst({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!staff?.department_id || staff.department_id !== meetingDepartmentId) {
      throw new ForbiddenException({
        message: 'You may only act on meetings from your own department',
        errorCode: 'FORBIDDEN_DEPARTMENT',
      });
    }
  }

  async create(user: JwtPayload, dto: CreateMeetingDto, userId: number) {
    const effectiveDepartmentId = (await this.resolveEffectiveDepartmentId(user, dto.department_id))!;
    const department = await this.prisma.departments.findUnique({ where: { id: effectiveDepartmentId } });
    if (!department) {
      throw new NotFoundException({ message: 'Department not found', errorCode: 'DEPARTMENT_NOT_FOUND' });
    }
    try {
      const row = await this.prisma.department_meetings.create({
        data: {
          department_id: effectiveDepartmentId,
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

  async findAll(user: JwtPayload, departmentId?: number) {
    const effectiveDepartmentId = await this.resolveEffectiveDepartmentId(user, departmentId);
    const rows = await this.prisma.department_meetings.findMany({
      where: effectiveDepartmentId !== undefined ? { department_id: effectiveDepartmentId } : undefined,
      orderBy: { meeting_at: 'desc' },
      select: MEETING_SELECT,
    });
    return rows.map(toResponse);
  }

  async updateMom(user: JwtPayload, id: number, momText: string) {
    const existing = await this.prisma.department_meetings.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Meeting not found', errorCode: 'MEETING_NOT_FOUND' });
    }
    await this.assertDepartmentAccess(user, existing.department_id);
    const row = await this.prisma.department_meetings.update({
      where: { id },
      data: { mom_text: momText, mom_status: momText.trim() ? 'recorded' : 'scheduled' },
      select: MEETING_SELECT,
    });
    return toResponse(row);
  }

  async circulate(user: JwtPayload, id: number) {
    const existing = await this.prisma.department_meetings.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Meeting not found', errorCode: 'MEETING_NOT_FOUND' });
    }
    await this.assertDepartmentAccess(user, existing.department_id);
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

  async addActionItem(user: JwtPayload, meetingId: number, label: string) {
    const existing = await this.prisma.department_meetings.findUnique({ where: { id: meetingId } });
    if (!existing) {
      throw new NotFoundException({ message: 'Meeting not found', errorCode: 'MEETING_NOT_FOUND' });
    }
    await this.assertDepartmentAccess(user, existing.department_id);
    await this.prisma.meeting_action_items.create({ data: { meeting_id: meetingId, label } });
    const row = await this.prisma.department_meetings.findUnique({ where: { id: meetingId }, select: MEETING_SELECT });
    return toResponse(row!);
  }

  async toggleActionItem(user: JwtPayload, meetingId: number, itemId: number) {
    const item = await this.prisma.meeting_action_items.findUnique({ where: { id: itemId } });
    if (!item || item.meeting_id !== meetingId) {
      throw new NotFoundException({ message: 'Action item not found', errorCode: 'ACTION_ITEM_NOT_FOUND' });
    }
    const meeting = await this.prisma.department_meetings.findUnique({ where: { id: meetingId } });
    await this.assertDepartmentAccess(user, meeting!.department_id);
    await this.prisma.meeting_action_items.update({ where: { id: itemId }, data: { done: !item.done } });
    const row = await this.prisma.department_meetings.findUnique({ where: { id: meetingId }, select: MEETING_SELECT });
    return toResponse(row!);
  }
}
