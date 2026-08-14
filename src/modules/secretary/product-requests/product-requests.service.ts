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
import { CreateProductRequestDto } from './dto/create-product-request.dto';
import { UpdateProductRequestDto } from './dto/update-product-request.dto';
import { ListProductRequestQueryDto } from './dto/list-product-request-query.dto';
import { ReviewProductRequestDto } from './dto/review-product-request.dto';

/** Whoever reviews a submitted request — see module README note on this default. */
const REVIEWER_ROLE = ROLES.ADMIN;

const PRODUCT_REQUEST_SELECT = {
  id: true,
  title: true,
  justification: true,
  status: true,
  created_at: true,
  updated_at: true,
  reviewed_at: true,
  secretary_product_request_items: {
    select: { id: true, product_name: true, quantity: true, purpose: true },
    orderBy: { id: 'asc' },
  },
  users_secretary_product_requests_requested_by_user_idTousers: {
    select: {
      id: true,
      email: true,
      faculty: { select: { first_name: true, last_name: true } },
      non_teaching_staff: { select: { first_name: true, last_name: true } },
    },
  },
  users_secretary_product_requests_reviewed_by_user_idTousers: {
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

interface ProductRequestRow {
  id: number;
  title: string;
  justification: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
  reviewed_at: Date | null;
  secretary_product_request_items: {
    id: number;
    product_name: string;
    quantity: number;
    purpose: string | null;
  }[];
  users_secretary_product_requests_requested_by_user_idTousers: RequestUserRow;
  users_secretary_product_requests_reviewed_by_user_idTousers: RequestUserRow | null;
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

function toResponse(request: ProductRequestRow) {
  const reviewer =
    request.users_secretary_product_requests_reviewed_by_user_idTousers;
  return {
    id: request.id,
    title: request.title,
    justification: request.justification,
    status: request.status,
    created_at: request.created_at,
    updated_at: request.updated_at,
    reviewed_at: request.reviewed_at,
    items: request.secretary_product_request_items,
    requested_by: {
      id: request.users_secretary_product_requests_requested_by_user_idTousers
        .id,
      name: resolveName(
        request.users_secretary_product_requests_requested_by_user_idTousers,
      ),
    },
    reviewed_by: reviewer
      ? { id: reviewer.id, name: resolveName(reviewer) }
      : null,
  };
}

@Injectable()
export class ProductRequestsService {
  private readonly logger = new Logger(ProductRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** POST /me/product-requests (Secretary). Always created as 'draft'. */
  async create(dto: CreateProductRequestDto, userId: number) {
    const request = await this.prisma.secretary_product_requests.create({
      data: {
        requested_by_user_id: userId,
        title: dto.title,
        justification: dto.justification,
        status: 'draft',
        ...(dto.items?.length && {
          secretary_product_request_items: {
            create: dto.items.map((item) => ({
              product_name: item.product_name,
              quantity: item.quantity,
              purpose: item.purpose,
            })),
          },
        }),
      },
      select: PRODUCT_REQUEST_SELECT,
    });

    this.logger.log(`Product request created: id=${request.id} by user=${userId}`);
    return toResponse(request);
  }

  /** GET /me/product-requests (Admin sees all; every other allowed role is own-only). */
  async findAll(query: ListProductRequestQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = { status: query.status };
    if (currentUser.role !== REVIEWER_ROLE) {
      where.requested_by_user_id = currentUser.sub;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.secretary_product_requests.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: PRODUCT_REQUEST_SELECT,
      }),
      this.prisma.secretary_product_requests.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /me/product-requests/:id (Admin sees any; every other allowed role only their own). */
  async findOne(id: number, currentUser: JwtPayload) {
    const request = await this.prisma.secretary_product_requests.findUnique({
      where: { id },
      select: { ...PRODUCT_REQUEST_SELECT, requested_by_user_id: true },
    });
    if (!request) {
      throw new NotFoundException('Product request not found');
    }
    if (
      currentUser.role !== REVIEWER_ROLE &&
      request.requested_by_user_id !== currentUser.sub
    ) {
      throw new ForbiddenException(
        'You may only view your own product requests',
      );
    }
    return toResponse(request);
  }

  /**
   * PATCH /me/product-requests/:id (Secretary, own request, only while 'draft').
   * `items`, if supplied, replaces the entire line-item list.
   */
  async update(id: number, dto: UpdateProductRequestDto, userId: number) {
    const existing = await this.prisma.secretary_product_requests.findUnique(
      { where: { id } },
    );
    if (!existing) {
      throw new NotFoundException('Product request not found');
    }
    if (existing.requested_by_user_id !== userId) {
      throw new ForbiddenException(
        'You may only edit your own product requests',
      );
    }
    if (existing.status !== 'draft') {
      throw new ConflictException('Only a draft request can be edited');
    }

    const request = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        await tx.secretary_product_request_items.deleteMany({
          where: { request_id: id },
        });
      }
      return tx.secretary_product_requests.update({
        where: { id },
        data: {
          ...(dto.title !== undefined && { title: dto.title }),
          ...(dto.justification !== undefined && {
            justification: dto.justification,
          }),
          updated_at: new Date(),
          ...(dto.items && {
            secretary_product_request_items: {
              create: dto.items.map((item) => ({
                product_name: item.product_name,
                quantity: item.quantity,
                purpose: item.purpose,
              })),
            },
          }),
        },
        select: PRODUCT_REQUEST_SELECT,
      });
    });

    return toResponse(request);
  }

  /**
   * POST /me/product-requests/:id/submit (Secretary, own request, only while 'draft').
   * Moves a draft to 'pending'. Requires at least one item, since a draft is
   * allowed to have none while still being edited.
   */
  async submit(id: number, userId: number) {
    const existing = await this.prisma.secretary_product_requests.findUnique(
      {
        where: { id },
        include: { secretary_product_request_items: true },
      },
    );
    if (!existing) {
      throw new NotFoundException('Product request not found');
    }
    if (existing.requested_by_user_id !== userId) {
      throw new ForbiddenException(
        'You may only submit your own product requests',
      );
    }
    if (existing.status !== 'draft') {
      throw new ConflictException('Only a draft request can be submitted');
    }
    if (existing.secretary_product_request_items.length === 0) {
      throw new ConflictException(
        'Add at least one product before submitting',
      );
    }

    const request = await this.prisma.secretary_product_requests.update({
      where: { id },
      data: { status: 'pending', updated_at: new Date() },
      select: PRODUCT_REQUEST_SELECT,
    });

    this.logger.log(`Product request submitted: id=${id} by user=${userId}`);
    return toResponse(request);
  }

  /**
   * PATCH /me/product-requests/:id/review (Admin only, only while 'pending').
   */
  async review(id: number, dto: ReviewProductRequestDto, reviewerId: number) {
    const existing = await this.prisma.secretary_product_requests.findUnique(
      { where: { id } },
    );
    if (!existing) {
      throw new NotFoundException('Product request not found');
    }
    if (existing.status !== 'pending') {
      throw new ConflictException(
        'This product request has already been reviewed',
      );
    }

    const request = await this.prisma.secretary_product_requests.update({
      where: { id },
      data: {
        status: dto.decision,
        reviewed_by_user_id: reviewerId,
        reviewed_at: new Date(),
        updated_at: new Date(),
      },
      select: PRODUCT_REQUEST_SELECT,
    });

    this.logger.log(
      `Product request ${id} reviewed: decision=${dto.decision} by user=${reviewerId}`,
    );

    await this.notifications.create({
      user_id: existing.requested_by_user_id,
      title: `Product request ${dto.decision}`,
      message: `Your product request "${existing.title}" has been ${dto.decision}.`,
    });

    return toResponse(request);
  }

  /** DELETE /me/product-requests/:id (Secretary, own request, only while 'draft'). */
  async remove(id: number, userId: number) {
    const existing = await this.prisma.secretary_product_requests.findUnique(
      { where: { id } },
    );
    if (!existing) {
      throw new NotFoundException('Product request not found');
    }
    if (existing.requested_by_user_id !== userId) {
      throw new ForbiddenException(
        'You may only delete your own product requests',
      );
    }
    if (existing.status !== 'draft') {
      throw new ConflictException('Only a draft request can be deleted');
    }

    await this.prisma.secretary_product_requests.delete({ where: { id } });

    this.logger.log(`Product request deleted: id=${id}`);
    return { id, deleted: true };
  }
}
