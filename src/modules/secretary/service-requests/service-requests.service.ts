import {
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
import { CreateServiceRequestDto } from './dto/create-service-request.dto';
import { UpdateServiceRequestDto } from './dto/update-service-request.dto';
import { ListServiceRequestQueryDto } from './dto/list-service-request-query.dto';
import { ReviewServiceRequestDto } from './dto/review-service-request.dto';

/** Whoever reviews a submitted request — see module README note on this default. */
const REVIEWER_ROLE = ROLES.ADMIN;

const SERVICE_REQUEST_SELECT = {
  id: true,
  title: true,
  justification: true,
  status: true,
  created_at: true,
  updated_at: true,
  reviewed_at: true,
  secretary_service_request_items: {
    select: { id: true, service_name: true },
    orderBy: { id: 'asc' },
  },
  users_secretary_service_requests_requested_by_user_idTousers: {
    select: {
      id: true,
      email: true,
      faculty: { select: { first_name: true, last_name: true } },
      non_teaching_staff: { select: { first_name: true, last_name: true } },
    },
  },
  users_secretary_service_requests_reviewed_by_user_idTousers: {
    select: {
      id: true,
      email: true,
      faculty: { select: { first_name: true, last_name: true } },
      non_teaching_staff: { select: { first_name: true, last_name: true } },
    },
  },
} as const;

interface RequestUserRow {
  id: number;
  email: string;
  faculty: { first_name: string; last_name: string } | null;
  non_teaching_staff: { first_name: string; last_name: string | null }[];
}

interface ServiceRequestRow {
  id: number;
  title: string;
  justification: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  reviewed_at: Date | null;
  secretary_service_request_items: { id: number; service_name: string }[];
  users_secretary_service_requests_requested_by_user_idTousers: RequestUserRow;
  users_secretary_service_requests_reviewed_by_user_idTousers: RequestUserRow | null;
}

/** Same faculty-then-non_teaching_staff-then-email fallback as VenuesService.resolveBookerName. */
function resolveName(user: RequestUserRow): string {
  if (user.faculty) {
    return `${user.faculty.first_name} ${user.faculty.last_name}`;
  }
  const staff = user.non_teaching_staff[0];
  if (staff) {
    return staff.last_name ? `${staff.first_name} ${staff.last_name}` : staff.first_name;
  }
  return user.email;
}

function toResponse(request: ServiceRequestRow) {
  const reviewer =
    request.users_secretary_service_requests_reviewed_by_user_idTousers;
  return {
    id: request.id,
    title: request.title,
    justification: request.justification,
    status: request.status,
    created_at: request.created_at,
    updated_at: request.updated_at,
    reviewed_at: request.reviewed_at,
    items: request.secretary_service_request_items,
    requested_by: {
      id: request.users_secretary_service_requests_requested_by_user_idTousers
        .id,
      name: resolveName(
        request.users_secretary_service_requests_requested_by_user_idTousers,
      ),
    },
    reviewed_by: reviewer
      ? { id: reviewer.id, name: resolveName(reviewer) }
      : null,
  };
}

@Injectable()
export class ServiceRequestsService {
  private readonly logger = new Logger(ServiceRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** POST /me/service-requests (Secretary). Always created as 'draft'. */
  async create(dto: CreateServiceRequestDto, userId: number) {
    const request = await this.prisma.secretary_service_requests.create({
      data: {
        requested_by_user_id: userId,
        title: dto.title,
        justification: dto.justification,
        status: 'draft',
        ...(dto.items?.length && {
          secretary_service_request_items: {
            create: dto.items.map((item) => ({
              service_name: item.service_name,
            })),
          },
        }),
      },
      select: SERVICE_REQUEST_SELECT,
    });

    this.logger.log(`Service request created: id=${request.id} by user=${userId}`);
    return toResponse(request);
  }

  /** GET /me/service-requests (Admin sees all; every other allowed role is own-only). */
  async findAll(query: ListServiceRequestQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = { status: query.status };
    if (currentUser.role !== REVIEWER_ROLE) {
      where.requested_by_user_id = currentUser.sub;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.secretary_service_requests.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: SERVICE_REQUEST_SELECT,
      }),
      this.prisma.secretary_service_requests.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /me/service-requests/:id (Admin sees any; every other allowed role only their own). */
  async findOne(id: number, currentUser: JwtPayload) {
    const request = await this.prisma.secretary_service_requests.findUnique({
      where: { id },
      select: { ...SERVICE_REQUEST_SELECT, requested_by_user_id: true },
    });
    if (!request) {
      throw new NotFoundException('Service request not found');
    }
    if (
      currentUser.role !== REVIEWER_ROLE &&
      request.requested_by_user_id !== currentUser.sub
    ) {
      throw new ForbiddenException(
        'You may only view your own service requests',
      );
    }
    return toResponse(request);
  }

  /**
   * PATCH /me/service-requests/:id (Secretary, own request, only while 'draft').
   * `items`, if supplied, replaces the entire line-item list.
   */
  async update(id: number, dto: UpdateServiceRequestDto, userId: number) {
    const existing = await this.prisma.secretary_service_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Service request not found');
    }
    if (existing.requested_by_user_id !== userId) {
      throw new ForbiddenException(
        'You may only edit your own service requests',
      );
    }
    if (existing.status !== 'draft') {
      throw new ConflictException('Only a draft request can be edited');
    }

    const request = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.secretary_service_request_items.deleteMany({
          where: { request_id: id },
        });
      }
      return tx.secretary_service_requests.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.justification !== undefined && {
            justification: dto.justification,
          }),
          updated_at: new Date(),
          ...(dto.items && {
            secretary_service_request_items: {
              create: dto.items.map((item) => ({
                service_name: item.service_name,
              })),
            },
          }),
        },
        select: SERVICE_REQUEST_SELECT,
      });
    });

    return toResponse(request);
  }

  /**
   * POST /me/service-requests/:id/submit (Secretary, own request, only while 'draft').
   * Moves a draft to 'pending'. Requires a title (always true — required at
   * creation) and at least one item, since a draft is allowed to have
   * neither while still being edited.
   */
  async submit(id: number, userId: number) {
    const existing = await this.prisma.secretary_service_requests.findUnique(
      {
        where: { id },
        include: { secretary_service_request_items: true },
      },
    );
    if (!existing) {
      throw new NotFoundException('Service request not found');
    }
    if (existing.requested_by_user_id !== userId) {
      throw new ForbiddenException(
        'You may only submit your own service requests',
      );
    }
    if (existing.status !== 'draft') {
      throw new ConflictException('Only a draft request can be submitted');
    }
    if (existing.secretary_service_request_items.length === 0) {
      throw new ConflictException(
        'Add at least one service before submitting',
      );
    }

    const request = await this.prisma.secretary_service_requests.update({
      where: { id },
      data: { status: 'pending', updated_at: new Date() },
      select: SERVICE_REQUEST_SELECT,
    });

    this.logger.log(`Service request submitted: id=${id} by user=${userId}`);
    return toResponse(request);
  }

  /**
   * PATCH /me/service-requests/:id/review (Admin only, only while 'pending').
   */
  async review(id: number, dto: ReviewServiceRequestDto, reviewerId: number) {
    const existing = await this.prisma.secretary_service_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Service request not found');
    }
    if (existing.status !== 'pending') {
      throw new ConflictException(
        'This service request has already been reviewed',
      );
    }

    const request = await this.prisma.secretary_service_requests.update({
      where: { id },
      data: {
        status: dto.decision,
        reviewed_by_user_id: reviewerId,
        reviewed_at: new Date(),
        updated_at: new Date(),
      },
      select: SERVICE_REQUEST_SELECT,
    });

    this.logger.log(
      `Service request ${id} reviewed: decision=${dto.decision} by user=${reviewerId}`,
    );

    await this.notifications.create({
      user_id: existing.requested_by_user_id,
      title: `Service request ${dto.decision}`,
      message: `Your service request "${existing.title}" has been ${dto.decision}.`,
    });

    return toResponse(request);
  }

  /** DELETE /me/service-requests/:id (Secretary, own request, only while 'draft'). */
  async remove(id: number, userId: number) {
    const existing = await this.prisma.secretary_service_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Service request not found');
    }
    if (existing.requested_by_user_id !== userId) {
      throw new ForbiddenException(
        'You may only delete your own service requests',
      );
    }
    if (existing.status !== 'draft') {
      throw new ConflictException('Only a draft request can be deleted');
    }

    await this.prisma.secretary_service_requests.delete({ where: { id } });

    this.logger.log(`Service request deleted: id=${id}`);
    return { id, deleted: true };
  }
}
