import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { paginate } from 'src/common/dto/pagination.dto';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { NotificationsService } from '../../notifications/notifications/notifications.service';
import { CreateMediaRequestDto } from './dto/create-media-request.dto';
import { UpdateMediaRequestDto } from './dto/update-media-request.dto';
import { ListMediaRequestQueryDto } from './dto/list-media-request-query.dto';

const MEDIA_REQUEST_SELECT = {
  id: true,
  description: true,
  status: true,
  media_file_url: true,
  created_at: true,
  event_name: true,
  event_date: true,
  coordinator_name: true,
  contact_number: true,
  media_types: true,
  faculty: {
    select: { id: true, first_name: true, last_name: true, designation: true },
  },
  venues: { select: { id: true, name: true, location: true } },
  users: {
    select: {
      id: true,
      email: true,
      faculty: { select: { first_name: true, last_name: true } },
      non_teaching_staff: { select: { first_name: true, last_name: true } },
    },
  },
} as const;

interface MediaRequestMarkerRow {
  id: number;
  email: string;
  faculty: { first_name: string; last_name: string } | null;
  non_teaching_staff: { first_name: string; last_name: string | null }[];
}

interface MediaRequestRow {
  id: number;
  description: string;
  status: string;
  media_file_url: string | null;
  created_at: Date;
  event_name: string | null;
  event_date: Date | null;
  coordinator_name: string | null;
  contact_number: string | null;
  media_types: string[];
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
  } | null;
  venues: { id: number; name: string; location: string | null } | null;
  users: MediaRequestMarkerRow;
}

/**
 * `requested_by_user_id` (generic — any role) is always present; the direct
 * `faculty` relation (via `requested_by_faculty_id`) is only set when the
 * requester is teaching staff (null for Secretary-submitted requests).
 * Mirrors VenuesService.resolveBookerName's fallback chain.
 */
function resolveRequesterName(requester: MediaRequestMarkerRow): string {
  if (requester.faculty) {
    return `${requester.faculty.first_name} ${requester.faculty.last_name}`;
  }
  const staff = requester.non_teaching_staff[0];
  if (staff) {
    return staff.last_name
      ? `${staff.first_name} ${staff.last_name}`
      : staff.first_name;
  }
  return requester.email;
}

function toResponse(request: MediaRequestRow) {
  return {
    id: request.id,
    description: request.description,
    status: request.status,
    media_file_url: request.media_file_url,
    created_at: request.created_at,
    event_name: request.event_name,
    event_date: request.event_date,
    venue: request.venues,
    coordinator_name: request.coordinator_name,
    contact_number: request.contact_number,
    media_types: request.media_types,
    faculty: request.faculty,
    requested_by: {
      id: request.users.id,
      name: resolveRequesterName(request.users),
    },
  };
}

@Injectable()
export class MediaRequestsService {
  private readonly logger = new Logger(MediaRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * POST /media-requests (Faculty / Secretary).
   *
   * `requested_by_user_id` is always set from the caller; `requested_by_faculty_id`
   * is only populated when the caller actually has a faculty profile (Secretary
   * doesn't). `event_name`/`event_date`/`venue_id`/`coordinator_name`/
   * `contact_number`/`media_types` are optional so Faculty's existing simple
   * `{ description }` submissions keep working unchanged.
   */
  async create(dto: CreateMediaRequestDto, currentUser: JwtPayload) {
    const userId = currentUser.sub;
    const faculty =
      currentUser.role === ROLES.FACULTY
        ? await this.resolveFacultyByUserId(userId)
        : null;

    if (dto.venue_id !== undefined) {
      const venue = await this.prisma.venues.findUnique({
        where: { id: dto.venue_id },
      });
      if (!venue) {
        throw new NotFoundException('Venue not found');
      }
    }

    const request = await this.prisma.media_requests.create({
      data: {
        requested_by_faculty_id: faculty?.id,
        requested_by_user_id: userId,
        description: dto.description,
        status: 'pending',
        event_name: dto.event_name,
        event_date: dto.event_date ? new Date(dto.event_date) : undefined,
        venue_id: dto.venue_id,
        coordinator_name: dto.coordinator_name,
        contact_number: dto.contact_number,
        media_types: dto.media_types ?? [],
      },
      select: MEDIA_REQUEST_SELECT,
    });

    this.logger.log(
      `Media request created: id=${request.id} requested_by_user=${userId}`,
    );
    return toResponse(request);
  }

  /** GET /media-requests (Media Room sees all; every other allowed role is own-only). Paginated, filterable. */
  async findAll(query: ListMediaRequestQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {
      status: query.status,
    };

    if (currentUser.role !== ROLES.MEDIA_ROOM) {
      where.requested_by_user_id = currentUser.sub;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.media_requests.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: MEDIA_REQUEST_SELECT,
      }),
      this.prisma.media_requests.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /media-requests/:id (Media Room sees any; every other allowed role only their own). */
  async findOne(id: number, currentUser: JwtPayload) {
    const request = await this.prisma.media_requests.findUnique({
      where: { id },
      select: { ...MEDIA_REQUEST_SELECT, requested_by_user_id: true },
    });
    if (!request) {
      throw new NotFoundException('Media request not found');
    }

    if (
      currentUser.role !== ROLES.MEDIA_ROOM &&
      request.requested_by_user_id !== currentUser.sub
    ) {
      throw new ForbiddenException(
        'You may only view your own media requests',
      );
    }

    return toResponse(request);
  }

  /**
   * PATCH /media-requests/:id (Media Room only).
   *
   * workflow.md: "if request is approved, the media is shared to the
   * faculty through the request window itself" — media_file_url is the
   * shared file, required exactly when transitioning to 'delivered'.
   */
  async update(id: number, dto: UpdateMediaRequestDto) {
    const existing = await this.prisma.media_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Media request not found');
    }

    if (existing.status !== 'pending' && existing.status !== 'approved') {
      throw new ConflictException(
        'This media request has already reached a final state',
      );
    }

    if (dto.status === 'delivered' && !dto.media_file_url) {
      throw new BadRequestException(
        'media_file_url is required when marking a request as delivered',
      );
    }

    const request = await this.prisma.media_requests.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.media_file_url !== undefined && {
          media_file_url: dto.media_file_url,
        }),
      },
      select: MEDIA_REQUEST_SELECT,
    });

    this.logger.log(`Media request ${id} updated to status=${dto.status}`);

    await this.notifications.create({
      user_id: existing.requested_by_user_id,
      title: `Media request ${dto.status}`,
      message: `Your media request has been ${dto.status}.`,
    });

    return toResponse(request);
  }

  /** DELETE /media-requests/:id (Faculty / Secretary — own request, only while still 'pending'). */
  async remove(id: number, userId: number) {
    const existing = await this.prisma.media_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Media request not found');
    }

    if (existing.requested_by_user_id !== userId) {
      throw new ForbiddenException(
        'You may only withdraw your own media requests',
      );
    }

    if (existing.status !== 'pending') {
      throw new ConflictException(
        'Only a request still pending can be withdrawn',
      );
    }

    await this.prisma.media_requests.delete({ where: { id } });

    this.logger.log(`Media request deleted: id=${id}`);
    return { id, deleted: true };
  }

  private async resolveFacultyByUserId(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }
}
