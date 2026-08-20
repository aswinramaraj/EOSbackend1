import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { formatStudentName } from '../common/student-name.util';
import { SearchOutingsDto } from './dto/search-outings.dto';
import { DecideOutingDto } from './dto/decide-outing.dto';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toTimeOnly(date: Date): string {
  return date.toISOString().slice(11, 16);
}

const OUTING_INCLUDE = {
  students: {
    select: {
      id: true,
      student_id_no: true,
      roll_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      users: { select: { email: true } },
      student_hostel_mapping: {
        select: {
          hostel_rooms: {
            select: {
              room_number: true,
              hostels: { select: { id: true, name: true, code: true } },
            },
          },
        },
      },
    },
  },
  users: { select: { email: true } },
} satisfies Prisma.hostel_outingsInclude;

type OutingWithRelations = Prisma.hostel_outingsGetPayload<{
  include: typeof OUTING_INCLUDE;
}>;

function toOutingResponse(outing: OutingWithRelations) {
  const student = outing.students;
  const name = formatStudentName(
    student.soa_applications?.first_name,
    student.soa_applications?.last_name,
    student.users.email,
  );
  const room = student.student_hostel_mapping?.hostel_rooms;

  return {
    id: outing.id,
    student: {
      id: student.id,
      name,
      student_id_no: student.student_id_no,
      roll_no: student.roll_no,
    },
    hostel: room?.hostels ?? null,
    room_number: room?.room_number ?? null,
    from_date: toDateOnly(outing.from_date),
    to_date: toDateOnly(outing.to_date),
    start_time: toTimeOnly(outing.start_time),
    return_time: outing.return_time ? toTimeOnly(outing.return_time) : null,
    reason: outing.reason,
    status: outing.status,
    approved_by_warden: outing.users?.email ?? null,
    created_at: outing.created_at.toISOString(),
  };
}

@Injectable()
export class OutingsService {
  private readonly logger = new Logger(OutingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /hostel/outings?status=&hostel_id=&page=&page_size= — warden-side review queue. */
  async findAll(dto: SearchOutingsDto) {
    const { status, hostel_id, page = 1, page_size = 20 } = dto;

    const where: Prisma.hostel_outingsWhereInput = {};
    if (status) where.status = status;
    if (hostel_id) {
      where.students = {
        student_hostel_mapping: { hostel_rooms: { hostel_id } },
      };
    }

    try {
      const [outings, total] = await Promise.all([
        this.prisma.hostel_outings.findMany({
          where,
          include: OUTING_INCLUDE,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * page_size,
          take: page_size,
        }),
        this.prisma.hostel_outings.count({ where }),
      ]);

      return { page, page_size, total, data: outings.map(toOutingResponse) };
    } catch (err) {
      this.logger.error('DB error while fetching outings', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /hostel/outings/:id/decision
   *
   * Error cases:
   *  404 OUTING_NOT_FOUND      – no outing with this id
   *  409 OUTING_ALREADY_DECIDED – outing is not currently pending
   */
  async decide(
    id: number,
    dto: DecideOutingDto,
    wardenUserId: number,
    wardenHostelId: number | null,
  ) {
    let outing: {
      status: string;
      students: {
        student_hostel_mapping: {
          hostel_rooms: { hostel_id: number };
        } | null;
      };
    } | null;
    try {
      outing = await this.prisma.hostel_outings.findUnique({
        where: { id },
        select: {
          status: true,
          students: {
            select: {
              student_hostel_mapping: {
                select: { hostel_rooms: { select: { hostel_id: true } } },
              },
            },
          },
        },
      });
    } catch (err) {
      this.logger.error('DB error during outing lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    // Treat "exists, but not my hostel's resident" the same as "doesn't
    // exist" — a warden of another hostel can't use this to confirm the
    // outing request exists.
    if (
      !outing ||
      (wardenHostelId != null &&
        outing.students.student_hostel_mapping?.hostel_rooms.hostel_id !==
          wardenHostelId)
    ) {
      throw new NotFoundException({
        message: 'Outing request not found',
        errorCode: 'OUTING_NOT_FOUND',
      });
    }

    if (outing.status !== 'pending') {
      throw new ConflictException({
        message: 'This outing request has already been decided',
        errorCode: 'OUTING_ALREADY_DECIDED',
      });
    }

    try {
      const updated = await this.prisma.hostel_outings.update({
        where: { id },
        data: {
          status: dto.decision,
          approved_by_warden_user_id: wardenUserId,
        },
        include: OUTING_INCLUDE,
      });
      return toOutingResponse(updated);
    } catch (err) {
      this.logger.error('DB error while deciding outing', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
