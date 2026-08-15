import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { formatStudentName } from '../common/student-name.util';
import { CreateGateLogDto } from './dto/create-gate-log.dto';
import { SearchGateLogDto } from './dto/search-gate-log.dto';

const LOG_INCLUDE = {
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
} satisfies Prisma.hostel_in_out_ledgerInclude;

type LogWithRelations = Prisma.hostel_in_out_ledgerGetPayload<{
  include: typeof LOG_INCLUDE;
}>;

function toLogResponse(entry: LogWithRelations) {
  const student = entry.students;
  const name = formatStudentName(
    student.soa_applications?.first_name,
    student.soa_applications?.last_name,
    student.users.email,
  );
  const room = student.student_hostel_mapping?.hostel_rooms;

  return {
    id: entry.id,
    student: {
      id: student.id,
      name,
      student_id_no: student.student_id_no,
      roll_no: student.roll_no,
    },
    hostel: room?.hostels ?? null,
    room_number: room?.room_number ?? null,
    entry_type: entry.entry_type,
    outing_id: entry.outing_id,
    recorded_at: entry.recorded_at.toISOString(),
    recorded_by: entry.users?.email ?? null,
  };
}

@Injectable()
export class GateLogService {
  private readonly logger = new Logger(GateLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /hostel/gate-log — a factual record that a student physically
   * passed through the gate (manual warden entry; no scanner integration
   * exists in this codebase). Not tied to the outings approval workflow
   * beyond the optional outing_id link — recording a movement doesn't
   * require an approved outing to exist first, since day-to-day comings and
   * goings aren't all outing-worthy.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – student_id does not exist
   *  400 OUTING_MISMATCH   – outing_id given but belongs to a different student
   *  404 OUTING_NOT_FOUND  – outing_id given but does not exist
   */
  async create(dto: CreateGateLogDto, recordedByUserId: number) {
    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    if (dto.outing_id) {
      const outing = await this.prisma.hostel_outings.findUnique({
        where: { id: dto.outing_id },
      });
      if (!outing) {
        throw new NotFoundException({
          message: 'Outing request not found',
          errorCode: 'OUTING_NOT_FOUND',
        });
      }
      if (outing.student_id !== dto.student_id) {
        throw new BadRequestException({
          message: 'This outing request does not belong to this student',
          errorCode: 'OUTING_MISMATCH',
        });
      }
    }

    try {
      const entry = await this.prisma.hostel_in_out_ledger.create({
        data: {
          student_id: dto.student_id,
          entry_type: dto.entry_type,
          outing_id: dto.outing_id,
          recorded_by_user_id: recordedByUserId,
        },
        include: LOG_INCLUDE,
      });
      return toLogResponse(entry);
    } catch (err) {
      this.logger.error('DB error while recording gate log entry', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /hostel/gate-log?student_id=&entry_type=&hostel_id=&page=&page_size= */
  async findAll(dto: SearchGateLogDto) {
    const { student_id, entry_type, hostel_id, page = 1, page_size = 20 } = dto;

    const where: Prisma.hostel_in_out_ledgerWhereInput = {};
    if (student_id) where.student_id = student_id;
    if (entry_type) where.entry_type = entry_type;
    if (hostel_id) {
      where.students = {
        student_hostel_mapping: { hostel_rooms: { hostel_id } },
      };
    }

    try {
      const [entries, total] = await this.prisma.$transaction([
        this.prisma.hostel_in_out_ledger.findMany({
          where,
          include: LOG_INCLUDE,
          orderBy: { recorded_at: 'desc' },
          skip: (page - 1) * page_size,
          take: page_size,
        }),
        this.prisma.hostel_in_out_ledger.count({ where }),
      ]);

      return { page, page_size, total, data: entries.map(toLogResponse) };
    } catch (err) {
      this.logger.error('DB error while fetching gate log', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
