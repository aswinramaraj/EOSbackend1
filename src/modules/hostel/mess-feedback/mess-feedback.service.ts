import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { CreateMessFeedbackDto } from './dto/create-mess-feedback.dto';
import { SearchMessFeedbackDto } from './dto/search-mess-feedback.dto';

@Injectable()
export class MessFeedbackService {
  private readonly logger = new Logger(MessFeedbackService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /hostel/mess-feedback
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – student_id does not exist
   */
  async create(dto: CreateMessFeedbackDto) {
    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.hostel_mess_feedback.create({
        data: {
          student_id: dto.student_id,
          hostel_id: dto.hostel_id,
          rating: dto.rating,
          comment: dto.comment,
        },
      });
    } catch (err) {
      this.logger.error('DB error while creating mess feedback', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** GET /hostel/mess-feedback?hostel_id=&page=&page_size= — list + average rating. */
  async findAll(dto: SearchMessFeedbackDto) {
    const { hostel_id, page = 1, page_size = 20 } = dto;
    const where: Prisma.hostel_mess_feedbackWhereInput = hostel_id
      ? { hostel_id }
      : {};

    try {
      const [entries, total, aggregate] = await this.prisma.$transaction([
        this.prisma.hostel_mess_feedback.findMany({
          where,
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * page_size,
          take: page_size,
        }),
        this.prisma.hostel_mess_feedback.count({ where }),
        this.prisma.hostel_mess_feedback.aggregate({
          where,
          _avg: { rating: true },
        }),
      ]);

      return {
        page,
        page_size,
        total,
        average_rating: aggregate._avg.rating
          ? Math.round(aggregate._avg.rating * 10) / 10
          : null,
        data: entries,
      };
    } catch (err) {
      this.logger.error('DB error while fetching mess feedback', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
