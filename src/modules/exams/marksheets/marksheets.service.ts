import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class MarksheetsService {
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

    const originalPublication = await this.prisma.result_publications.findFirst(
      {
        where: { exam_id: examId, publication_type: 'original' },
      },
    );
    if (!originalPublication) {
      throw new UnprocessableEntityException({
        message: 'Results for this exam have not been published yet',
        errorCode: 'RESULTS_NOT_PUBLISHED',
      });
    }

    // marksheets has no @@unique([exam_id, student_id]) in the schema, unlike
    // hall_tickets — this duplicate check is application-level only.
    const existing = await this.prisma.marksheets.findFirst({
      where: { exam_id: examId, student_id: studentId },
    });
    if (existing) {
      throw new ConflictException({
        message:
          'Marksheet has already been generated for this student and exam',
        errorCode: 'ALREADY_GENERATED',
      });
    }

    return this.prisma.marksheets.create({
      data: {
        exam_id: examId,
        student_id: studentId,
        file_url: `/documents/marksheets/${studentId}_${examId}.pdf`,
      },
    });
  }

  async findOne(examId: number, studentId: number) {
    const marksheet = await this.prisma.marksheets.findFirst({
      where: { exam_id: examId, student_id: studentId },
    });

    if (!marksheet) {
      throw new NotFoundException({
        message: 'Marksheet not found for this exam and student',
        errorCode: 'MARKSHEET_NOT_FOUND',
      });
    }

    return marksheet;
  }
}
