import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';

@Injectable()
export class HallTicketsService {
  private readonly logger = new Logger(HallTicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async generate(examId: number, studentId: number) {
    const exam = await this.prisma.exams.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const publishedSlot = await this.prisma.exam_timetable.findFirst({
      where: {
        exam_subject_mapping: { exam_id: examId, is_published: true },
      },
    });
    if (!publishedSlot) {
      throw new UnprocessableEntityException({
        message: 'The exam timetable has not been published yet',
        errorCode: 'TIMETABLE_NOT_PUBLISHED',
      });
    }

    const existing = await this.prisma.hall_tickets.findUnique({
      where: { exam_id_student_id: { exam_id: examId, student_id: studentId } },
    });
    if (existing) {
      throw new ConflictException({
        message:
          'Hall ticket has already been generated for this student and exam',
        errorCode: 'ALREADY_GENERATED',
      });
    }

    const hallTicket = await this.prisma.hall_tickets.create({
      data: {
        exam_id: examId,
        student_id: studentId,
        file_url: `/documents/hall-tickets/${studentId}_${examId}.pdf`,
      },
    });

    try {
      await this.notifications.notify({
        user_id: student.user_id,
        title: 'Hall ticket issued',
        message: `Your hall ticket for ${exam.title ?? 'your exam'} is ready.`,
        type: 'hall_ticket_issued',
        related_entity_type: 'hall_ticket',
        related_entity_id: hallTicket.id,
      });
    } catch (err) {
      // Never fail the issuance itself - the hall ticket has already
      // committed by this point.
      this.logger.error(`Failed to notify student ${studentId} of hall ticket issuance`, err);
    }

    return hallTicket;
  }

  async findOne(examId: number, studentId: number) {
    const hallTicket = await this.prisma.hall_tickets.findUnique({
      where: { exam_id_student_id: { exam_id: examId, student_id: studentId } },
    });

    if (!hallTicket) {
      throw new NotFoundException({
        message: 'Hall ticket not found for this exam and student',
        errorCode: 'HALL_TICKET_NOT_FOUND',
      });
    }

    return hallTicket;
  }
}
