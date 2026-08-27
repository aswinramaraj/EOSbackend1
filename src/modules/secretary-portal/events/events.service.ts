import { ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { CreateEventDto } from './dto/create-event.dto';

const EVENT_SELECT = {
  id: true,
  title: true,
  kind: true,
  event_date: true,
  status: true,
  registrations: true,
  capacity: true,
  created_at: true,
  departments: { select: { id: true, name: true, code: true } },
  venues: { select: { id: true, name: true } },
  faculty: { select: { id: true, first_name: true, last_name: true } },
} as const;

const STATUS_CYCLE = ['planning', 'awaiting_approval', 'approved', 'completed'] as const;

function nextOf(cur: string): string {
  const i = STATUS_CYCLE.indexOf(cur as (typeof STATUS_CYCLE)[number]);
  return STATUS_CYCLE[(i + 1) % STATUS_CYCLE.length];
}

function toResponse(row: {
  id: number;
  title: string;
  kind: string;
  event_date: string;
  status: string;
  registrations: number;
  capacity: number;
  created_at: Date;
  departments: { id: number; name: string; code: string };
  venues: { id: number; name: string } | null;
  faculty: { id: number; first_name: string; last_name: string } | null;
}) {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    event_date: row.event_date,
    status: row.status,
    registrations: row.registrations,
    capacity: row.capacity,
    created_at: row.created_at,
    department: row.departments,
    venue: row.venues,
    owner: row.faculty,
  };
}

/** Event & Workshop Coordination — Secretary Portal screen. Distinct from
 * venue_bookings (a room-approval flow) and edc_events (EDC-coordinator-only).
 * Institution-wide for Secretary/Admin/Principal. */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);

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

  /** A Secretary may only act on events belonging to her own department — other roles are unrestricted. */
  private async assertDepartmentAccess(user: JwtPayload, eventDepartmentId: number): Promise<void> {
    if (user.role !== ROLES.SECRETARY) return;
    const staff = await this.prisma.non_teaching_staff.findFirst({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!staff?.department_id || staff.department_id !== eventDepartmentId) {
      throw new ForbiddenException({
        message: 'You may only act on events from your own department',
        errorCode: 'FORBIDDEN_DEPARTMENT',
      });
    }
  }

  async create(user: JwtPayload, dto: CreateEventDto, userId: number) {
    const effectiveDepartmentId = (await this.resolveEffectiveDepartmentId(user, dto.department_id))!;
    const department = await this.prisma.departments.findUnique({ where: { id: effectiveDepartmentId } });
    if (!department) {
      throw new NotFoundException({ message: 'Department not found', errorCode: 'DEPARTMENT_NOT_FOUND' });
    }
    try {
      const row = await this.prisma.department_events.create({
        data: {
          department_id: effectiveDepartmentId,
          title: dto.title,
          kind: dto.kind,
          event_date: dto.event_date,
          venue_id: dto.venue_id,
          owner_faculty_id: dto.owner_faculty_id,
          status: 'planning',
          registrations: 0,
          capacity: dto.capacity,
          created_by_user_id: userId,
        },
        select: EVENT_SELECT,
      });
      return toResponse(row);
    } catch (err) {
      this.logger.error('DB error creating event', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async findAll(user: JwtPayload, departmentId?: number) {
    const effectiveDepartmentId = await this.resolveEffectiveDepartmentId(user, departmentId);
    const rows = await this.prisma.department_events.findMany({
      where: effectiveDepartmentId !== undefined ? { department_id: effectiveDepartmentId } : undefined,
      orderBy: { created_at: 'desc' },
      select: EVENT_SELECT,
    });
    return rows.map(toResponse);
  }

  async register(user: JwtPayload, id: number, count: number) {
    const existing = await this.prisma.department_events.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Event not found', errorCode: 'EVENT_NOT_FOUND' });
    }
    await this.assertDepartmentAccess(user, existing.department_id);
    const nextRegs = Math.min(existing.capacity, existing.registrations + count);
    const row = await this.prisma.department_events.update({ where: { id }, data: { registrations: nextRegs }, select: EVENT_SELECT });
    return toResponse(row);
  }

  async advance(user: JwtPayload, id: number) {
    const existing = await this.prisma.department_events.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Event not found', errorCode: 'EVENT_NOT_FOUND' });
    }
    await this.assertDepartmentAccess(user, existing.department_id);
    const next = existing.status === 'completed' ? 'planning' : nextOf(existing.status);
    const row = await this.prisma.department_events.update({
      where: { id },
      data: { status: next as 'planning' | 'awaiting_approval' | 'approved' | 'completed' },
      select: EVENT_SELECT,
    });
    return toResponse(row);
  }
}
