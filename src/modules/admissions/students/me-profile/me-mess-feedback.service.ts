import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateMyMessFeedbackDto } from './dto/create-my-mess-feedback.dto';

@Injectable()
export class MeMessFeedbackService {
  private readonly logger = new Logger(MeMessFeedbackService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /me/mess-feedback
   *
   * Self-scoped: student_id resolved from the JWT. `hostel_id` is resolved
   * server-side from the caller's own student_hostel_mapping - same
   * hosteller gate as hostel complaints/outings, since hostel_mess_feedback
   * is rating the caller's own hostel's mess.
   *
   * hostel_mess_feedback only has a single 1-5 `rating` + free-text
   * `comment` - there's no multi-dimension (food/hygiene/service) column,
   * that composition happens client-side before this call.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  422 NOT_A_HOSTELLER   – caller has no student_hostel_mapping row
   *  500 INTERNAL_ERROR    – unexpected DB failure
   */
  async createFeedback(userId: number, dto: CreateMyMessFeedbackDto) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const mapping = await this.prisma.student_hostel_mapping.findUnique({
      where: { student_id: student.id },
      select: { hostel_rooms: { select: { hostel_id: true } } },
    });
    if (!mapping) {
      throw new UnprocessableEntityException({
        message: 'Only hostellers can submit mess feedback',
        errorCode: 'NOT_A_HOSTELLER',
      });
    }

    try {
      const feedback = await this.prisma.hostel_mess_feedback.create({
        data: {
          student_id: student.id,
          hostel_id: mapping.hostel_rooms.hostel_id,
          rating: dto.rating,
          comment: dto.comment,
        },
      });

      return {
        id: feedback.id,
        rating: feedback.rating,
        comment: feedback.comment,
        created_at: feedback.created_at.toISOString(),
      };
    } catch (err) {
      this.logger.error(`Failed to create mess feedback for user ${userId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
