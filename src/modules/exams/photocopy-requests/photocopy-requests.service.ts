import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { FindPhotocopyRequestsQueryDto } from './dto/find-photocopy-requests-query.dto';
import { UpdatePhotocopyRequestDto } from './dto/update-photocopy-request.dto';
import { CreatePhotocopyRequestDto } from './dto/create-photocopy-request.dto';

const INCLUDE = {
  students: {
    select: {
      id: true,
      student_id_no: true,
      roll_no: true,
      register_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
    },
  },
  exam_marks: {
    select: {
      id: true,
      marks_obtained: true,
      max_marks: true,
      exam_subject_mapping: {
        select: {
          id: true,
          exam_id: true,
          subjects: { select: { id: true, name: true, subject_code: true } },
          classes: { select: { department_id: true, departments: { select: { code: true, name: true } } } },
        },
      },
    },
  },
} as const;

/** Decimal fields serialize to JSON as strings (decimal.js's toJSON is toString()) — convert at the boundary so summing fee_amount client-side is real addition, not string concatenation. */
function withNumericFee<T extends { fee_amount: Prisma.Decimal }>(row: T) {
  return { ...row, fee_amount: Number(row.fee_amount) };
}

@Injectable()
export class PhotocopyRequestsService {
  private readonly logger = new Logger(PhotocopyRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** POST /photocopy-requests — counter entry (COE is the only role with access to this controller at all, so there's no separate student-vs-counter path to widen here). */
  async create(dto: CreatePhotocopyRequestDto) {
    const examMark = await this.prisma.exam_marks.findUnique({ where: { id: dto.exam_marks_id } });
    if (!examMark) {
      throw new NotFoundException({ message: 'Exam marks record not found.', errorCode: 'EXAM_MARKS_NOT_FOUND' });
    }
    const student = await this.prisma.students.findUnique({ where: { id: dto.student_id } });
    if (!student) {
      throw new NotFoundException({ message: 'Student not found.', errorCode: 'STUDENT_NOT_FOUND' });
    }

    const existing = await this.prisma.photocopy_requests.findUnique({
      where: { student_id_exam_marks_id: { student_id: dto.student_id, exam_marks_id: dto.exam_marks_id } },
    });
    if (existing) {
      throw new ConflictException({ message: 'A photocopy request already exists for this exam mark.', errorCode: 'PHOTOCOPY_REQUEST_EXISTS' });
    }

    const created = await this.prisma.photocopy_requests.create({
      data: { exam_marks_id: dto.exam_marks_id, student_id: dto.student_id, fee_amount: dto.fee_amount },
      include: INCLUDE,
    });
    return withNumericFee(created);
  }

  async findAll(query: FindPhotocopyRequestsQueryDto) {
    const where: Prisma.photocopy_requestsWhereInput = {};
    if (query.student_id !== undefined) where.student_id = query.student_id;
    if (query.status !== undefined) where.status = query.status;

    try {
      const [data, total] = await this.prisma.$transaction([
        this.prisma.photocopy_requests.findMany({
          where,
          skip: query.skip,
          take: query.limit,
          orderBy: [{ applied_at: 'desc' }],
          include: INCLUDE,
        }),
        this.prisma.photocopy_requests.count({ where }),
      ]);

      return paginate(data.map(withNumericFee), total, query);
    } catch (err: any) {
      this.logger.error('DB error while fetching photocopy requests', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async update(
    id: number,
    dto: UpdatePhotocopyRequestDto,
    processedByUserId: number,
  ) {
    const existing = await this.prisma.photocopy_requests.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Photocopy request not found.',
        errorCode: 'PHOTOCOPY_REQUEST_NOT_FOUND',
      });
    }

    try {
      const updated = await this.prisma.photocopy_requests.update({
        where: { id },
        data: {
          status: dto.status,
          processed_by_user_id: processedByUserId,
          processed_at: new Date(),
        },
        include: INCLUDE,
      });
      return withNumericFee(updated);
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        err.code === 'P2025'
      ) {
        throw new NotFoundException({
          message: 'Photocopy request not found.',
          errorCode: 'PHOTOCOPY_REQUEST_NOT_FOUND',
        });
      }
      this.logger.error('DB error while updating photocopy request', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
