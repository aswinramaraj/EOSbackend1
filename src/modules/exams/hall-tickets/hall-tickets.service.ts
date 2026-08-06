import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class HallTicketsService {
  constructor(private readonly prisma: PrismaService) {}

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
        exam_timetable_versions: { status: 'published' },
        exam_subject_mapping: { exam_id: examId },
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

    return this.prisma.hall_tickets.create({
      data: {
        exam_id: examId,
        student_id: studentId,
        file_url: `/documents/hall-tickets/${studentId}_${examId}.pdf`,
      },
    });
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
