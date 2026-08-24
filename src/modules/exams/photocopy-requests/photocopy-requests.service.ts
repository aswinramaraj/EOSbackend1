import {
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
        },
      },
    },
  },
} as const;

@Injectable()
export class PhotocopyRequestsService {
  private readonly logger = new Logger(PhotocopyRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

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

      return paginate(data, total, query);
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
      return await this.prisma.photocopy_requests.update({
        where: { id },
        data: {
          status: dto.status,
          processed_by_user_id: processedByUserId,
          processed_at: new Date(),
        },
        include: INCLUDE,
      });
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
