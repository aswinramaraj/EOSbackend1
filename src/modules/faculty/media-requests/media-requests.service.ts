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
import { CreateMediaRequestDto } from './dto/create-media-request.dto';
import { UpdateMediaRequestDto } from './dto/update-media-request.dto';
import { ListMediaRequestQueryDto } from './dto/list-media-request-query.dto';

const MEDIA_REQUEST_SELECT = {
  id: true,
  description: true,
  status: true,
  media_file_url: true,
  created_at: true,
  faculty: {
    select: { id: true, first_name: true, last_name: true, designation: true },
  },
} as const;

interface MediaRequestRow {
  id: number;
  description: string;
  status: string;
  media_file_url: string | null;
  created_at: Date;
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
  } | null;
}

function toResponse(request: MediaRequestRow) {
  return {
    id: request.id,
    description: request.description,
    status: request.status,
    media_file_url: request.media_file_url,
    created_at: request.created_at,
    faculty: request.faculty,
  };
}

@Injectable()
export class MediaRequestsService {
  private readonly logger = new Logger(MediaRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** POST /media-requests (Faculty only). */
  async create(dto: CreateMediaRequestDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const request = await this.prisma.media_requests.create({
      data: {
        requested_by_faculty_id: faculty.id,
        requested_by_user_id: userId,
        description: dto.description,
        status: 'pending',
      },
      select: MEDIA_REQUEST_SELECT,
    });

    this.logger.log(
      `Media request created: id=${request.id} faculty=${faculty.id}`,
    );
    return toResponse(request);
  }

  /** GET /media-requests (Faculty own-only / Media Room all). Paginated, filterable. */
  async findAll(query: ListMediaRequestQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {
      status: query.status,
    };

    if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      where.requested_by_faculty_id = faculty.id;
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

  /** GET /media-requests/:id (Faculty own-only / Media Room all). */
  async findOne(id: number, currentUser: JwtPayload) {
    const request = await this.prisma.media_requests.findUnique({
      where: { id },
      select: MEDIA_REQUEST_SELECT,
    });
    if (!request) {
      throw new NotFoundException('Media request not found');
    }

    if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      if (request.faculty?.id !== faculty.id) {
        throw new ForbiddenException(
          'You may only view your own media requests',
        );
      }
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
    return toResponse(request);
  }

  /** DELETE /media-requests/:id (Faculty only — own request, only while still 'pending'). */
  async remove(id: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const existing = await this.prisma.media_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Media request not found');
    }

    if (existing.requested_by_faculty_id !== faculty.id) {
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
