import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { CreateQuitRequestDto } from './dto/create-quit-request.dto';
import { DecideQuitRequestDto } from './dto/decide-quit-request.dto';
import { SearchQuitRequestsDto } from './dto/search-quit-requests.dto';

const QUIT_REQUEST_INCLUDE = {
  students: {
    select: {
      id: true,
      student_id_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
    },
  },
  hostel_rooms: {
    select: {
      room_number: true,
      hostels: { select: { id: true, name: true, code: true } },
    },
  },
} satisfies Prisma.hostel_quit_requestsInclude;

type QuitRequestWithRelations = Prisma.hostel_quit_requestsGetPayload<{
  include: typeof QUIT_REQUEST_INCLUDE;
}>;

function toQuitRequestResponse(request: QuitRequestWithRelations) {
  const student = request.students;
  const name = student.soa_applications
    ? `${student.soa_applications.first_name} ${student.soa_applications.last_name ?? ''}`.trim()
    : `Student ${student.student_id_no}`;

  return {
    id: request.id,
    student: { id: student.id, name, student_id_no: student.student_id_no },
    hostel: request.hostel_rooms.hostels,
    room_number: request.hostel_rooms.room_number,
    requested_date: request.requested_date.toISOString().slice(0, 10),
    reason: request.reason,
    fee_status: request.fee_status,
    status: request.status,
    resolved_at: request.resolved_at?.toISOString() ?? null,
    created_at: request.created_at.toISOString(),
  };
}

@Injectable()
export class QuitRequestsService {
  private readonly logger = new Logger(QuitRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /hostel-quit-requests
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND      – student_id does not exist
   *  409 STUDENT_NOT_ALLOTTED   – student has no current room allotment
   *  409 QUIT_REQUEST_PENDING   – student already has a pending quit request
   */
  async create(dto: CreateQuitRequestDto) {
    const mapping = await this.prisma.student_hostel_mapping.findUnique({
      where: { student_id: dto.student_id },
    });

    if (!mapping) {
      const student = await this.prisma.students.findUnique({
        where: { id: dto.student_id },
      });
      if (!student) {
        throw new NotFoundException({
          message: 'Student not found',
          errorCode: 'STUDENT_NOT_FOUND',
        });
      }
      throw new ConflictException({
        message: 'Student does not have a current hostel room allotment',
        errorCode: 'STUDENT_NOT_ALLOTTED',
      });
    }

    const pending = await this.prisma.hostel_quit_requests.findFirst({
      where: { student_id: dto.student_id, status: 'pending' },
    });
    if (pending) {
      throw new ConflictException({
        message: 'This student already has a pending quit request',
        errorCode: 'QUIT_REQUEST_PENDING',
      });
    }

    try {
      const request = await this.prisma.hostel_quit_requests.create({
        data: {
          student_id: dto.student_id,
          room_id: mapping.room_id,
          reason: dto.reason,
        },
        include: QUIT_REQUEST_INCLUDE,
      });
      return toQuitRequestResponse(request);
    } catch (err) {
      this.logger.error('DB error while creating hostel quit request', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /hostel-quit-requests?status=&page=&page_size= */
  async findAll(dto: SearchQuitRequestsDto) {
    const { status, page = 1, page_size = 20 } = dto;

    const where: Prisma.hostel_quit_requestsWhereInput = {};
    if (status) where.status = status;

    try {
      const [requests, total] = await this.prisma.$transaction([
        this.prisma.hostel_quit_requests.findMany({
          where,
          include: QUIT_REQUEST_INCLUDE,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * page_size,
          take: page_size,
        }),
        this.prisma.hostel_quit_requests.count({ where }),
      ]);

      return {
        page,
        page_size,
        total,
        data: requests.map(toQuitRequestResponse),
      };
    } catch (err) {
      this.logger.error('DB error while fetching hostel quit requests', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /hostel-quit-requests/:id/decision
   *
   * On approval, removes the student's current student_hostel_mapping row
   * inside the same transaction as the status update — never approve a quit
   * request without actually freeing the room.
   *
   * Error cases:
   *  404 QUIT_REQUEST_NOT_FOUND      – no quit request with this id
   *  409 QUIT_REQUEST_ALREADY_DECIDED – request is not currently pending
   */
  async decide(
    id: number,
    dto: DecideQuitRequestDto,
    resolvedByUserId: number,
  ) {
    const request = await this.prisma.hostel_quit_requests.findUnique({
      where: { id },
    });

    if (!request) {
      throw new NotFoundException({
        message: 'Quit request not found',
        errorCode: 'QUIT_REQUEST_NOT_FOUND',
      });
    }

    if (request.status !== 'pending') {
      throw new ConflictException({
        message: 'This quit request has already been decided',
        errorCode: 'QUIT_REQUEST_ALREADY_DECIDED',
      });
    }

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.hostel_quit_requests.update({
          where: { id },
          data: {
            status: dto.decision,
            fee_status:
              dto.decision === 'approved'
                ? (dto.fee_status ?? 'pending')
                : undefined,
            resolved_at: new Date(),
            resolved_by_user_id: resolvedByUserId,
          },
          include: QUIT_REQUEST_INCLUDE,
        });

        if (dto.decision === 'approved') {
          await tx.student_hostel_mapping.deleteMany({
            where: {
              student_id: request.student_id,
              room_id: request.room_id,
            },
          });
        }

        return result;
      });
      return toQuitRequestResponse(updated);
    } catch (err) {
      this.logger.error('DB error while deciding hostel quit request', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
