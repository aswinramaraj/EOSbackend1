import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import {
  FACULTY_DISPLAY_SELECT,
  FacultyWithDisplay,
  INTERNAL_ERROR,
  resolveFacultyName,
  resolveStudentName,
  STUDENT_DISPLAY_INCLUDE,
  studentAcademicMeta,
} from '../common/sports-common';
import { CreateOdRequestDto } from './dto/create-od-request.dto';
import { SearchOdRequestsDto } from './dto/search-od-requests.dto';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const OD_REQUEST_INCLUDE = {
  faculty: { select: FACULTY_DISPLAY_SELECT },
  _count: { select: { sports_od_squad_members: true } },
} satisfies Prisma.sports_od_requestsInclude;

type OdRequestWithRelations = Prisma.sports_od_requestsGetPayload<{
  include: typeof OD_REQUEST_INCLUDE;
}>;

const OD_REQUEST_DETAIL_INCLUDE = {
  faculty: { select: FACULTY_DISPLAY_SELECT },
  sports_od_squad_members: {
    select: {
      student_id: true,
      students: { include: STUDENT_DISPLAY_INCLUDE },
    },
  },
  _count: { select: { sports_od_squad_members: true } },
} satisfies Prisma.sports_od_requestsInclude;

type OdRequestWithDetail = Prisma.sports_od_requestsGetPayload<{
  include: typeof OD_REQUEST_DETAIL_INCLUDE;
}>;

function toAccompanyingCoach(faculty: FacultyWithDisplay | null) {
  return faculty ? { id: faculty.id, name: resolveFacultyName(faculty) } : null;
}

function toOdRequestResponse(row: OdRequestWithRelations) {
  return {
    id: row.id,
    od_type: row.od_type,
    event: row.event,
    from_date: toDateOnly(row.from_date),
    to_date: toDateOnly(row.to_date),
    venue: row.venue,
    level: row.level,
    status: row.status,
    squad_size: row._count.sports_od_squad_members,
    accompanying_coach: toAccompanyingCoach(row.faculty),
  };
}

function toOdRequestDetailResponse(row: OdRequestWithDetail) {
  return {
    ...toOdRequestResponse(row),
    squad: row.sports_od_squad_members.map((member) => ({
      student_id: member.student_id,
      name: resolveStudentName(member.students),
      meta: studentAcademicMeta(member.students),
    })),
  };
}

@Injectable()
export class OdService {
  private readonly logger = new Logger(OdService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /sports-admin/od-requests?status= */
  async findAll(dto: SearchOdRequestsDto) {
    const where: Prisma.sports_od_requestsWhereInput = {};
    if (dto.status) where.status = dto.status;

    try {
      const rows = await this.prisma.sports_od_requests.findMany({
        where,
        include: OD_REQUEST_INCLUDE,
        orderBy: { created_at: 'desc' },
      });
      return rows.map(toOdRequestResponse);
    } catch (err) {
      this.logger.error('DB error while fetching OD requests', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/od-requests
   *
   * Error cases:
   *  400 OD_SQUAD_REQUIRED – student_ids is empty
   */
  async create(dto: CreateOdRequestDto, userId: number) {
    if (!dto.student_ids || dto.student_ids.length === 0) {
      throw new BadRequestException({
        message: 'At least one student must be added to the OD squad',
        errorCode: 'OD_SQUAD_REQUIRED',
      });
    }

    let requestId: number;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const request = await tx.sports_od_requests.create({
          data: {
            od_type: dto.od_type,
            periods_affected: dto.periods_affected,
            from_date: new Date(dto.from_date),
            to_date: new Date(dto.to_date),
            event: dto.event,
            venue: dto.venue,
            level: dto.level,
            accompanying_coach_faculty_id: dto.accompanying_coach_faculty_id,
            transport: dto.transport,
            remarks: dto.remarks,
            requested_by_user_id: userId,
          },
        });

        await tx.sports_od_squad_members.createMany({
          data: dto.student_ids.map((student_id) => ({
            od_request_id: request.id,
            student_id,
          })),
        });

        return request;
      });
      requestId = created.id;
    } catch (err) {
      this.logger.error('DB error while creating OD request', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    return this.findOne(requestId);
  }

  /**
   * GET /sports-admin/od-requests/:id
   *
   * Error cases:
   *  404 OD_REQUEST_NOT_FOUND – no OD request with this id
   */
  async findOne(id: number) {
    let row: OdRequestWithDetail | null;
    try {
      row = await this.prisma.sports_od_requests.findUnique({
        where: { id },
        include: OD_REQUEST_DETAIL_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during OD request lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!row) {
      throw new NotFoundException({
        message: 'OD request not found',
        errorCode: 'OD_REQUEST_NOT_FOUND',
      });
    }
    return toOdRequestDetailResponse(row);
  }

  /**
   * POST /sports-admin/od-requests/:id/approve
   *
   * Error cases:
   *  404 OD_REQUEST_NOT_FOUND – no OD request with this id
   *  409 OD_REQUEST_ALREADY_DECIDED – request is not currently pending
   */
  async approve(id: number, userId: number) {
    return this.decide(id, 'approved', userId);
  }

  /** POST /sports-admin/od-requests/:id/reject — same error cases as approve. */
  async reject(id: number, userId: number) {
    return this.decide(id, 'rejected', userId);
  }

  private async decide(
    id: number,
    status: 'approved' | 'rejected',
    userId: number,
  ) {
    let existing: { status: string } | null;
    try {
      existing = await this.prisma.sports_od_requests.findUnique({
        where: { id },
      });
    } catch (err) {
      this.logger.error('DB error during OD request lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!existing) {
      throw new NotFoundException({
        message: 'OD request not found',
        errorCode: 'OD_REQUEST_NOT_FOUND',
      });
    }

    if (existing.status !== 'pending') {
      throw new ConflictException({
        message: 'This OD request has already been decided',
        errorCode: 'OD_REQUEST_ALREADY_DECIDED',
      });
    }

    try {
      const updated = await this.prisma.sports_od_requests.update({
        where: { id },
        data: {
          status,
          reviewed_by_user_id: userId,
          reviewed_at: new Date(),
        },
        include: OD_REQUEST_INCLUDE,
      });
      return toOdRequestResponse(updated);
    } catch (err) {
      this.logger.error('DB error while deciding OD request', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
