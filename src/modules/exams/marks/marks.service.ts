// marks.service.ts
import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateMarkDto } from './dto/create-mark.dto';
import { UpdateMarkDto } from './dto/update-mark.dto';
import { ListExamMarksQueryDto } from './dto/list-exam-marks-query.dto';

@Injectable()
export class MarksService {
  private readonly logger = new Logger(MarksService.name);

  constructor(private readonly prisma: PrismaService) {}

  private assertValidMarks(
    marksObtained: number | undefined,
    maxMarks: number,
  ) {
    if (marksObtained !== undefined && marksObtained > maxMarks) {
      throw new BadRequestException({
        message: 'marks_obtained cannot be greater than max_marks.',
        errorCode: 'INVALID_MARKS',
      });
    }
  }

  async create(createMarkDto: CreateMarkDto) {
    const {
      exam_subject_mapping_id,
      student_id,
      marks_obtained,
      max_marks,
      entered_by_faculty_id,
    } = createMarkDto;

    const mapping = await this.prisma.exam_subject_mapping.findUnique({
      where: { id: exam_subject_mapping_id },
    });

    if (!mapping) {
      throw new NotFoundException({
        message: 'Exam subject mapping not found.',
        errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
      });
    }

    const student = await this.prisma.students.findUnique({
      where: { id: student_id },
    });

    if (!student) {
      throw new NotFoundException({
        message: 'Student not found.',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    if (entered_by_faculty_id !== undefined) {
      const faculty = await this.prisma.faculty.findUnique({
        where: { id: entered_by_faculty_id },
      });

      if (!faculty) {
        throw new NotFoundException({
          message: 'Faculty not found.',
          errorCode: 'FACULTY_NOT_FOUND',
        });
      }
    }

    this.assertValidMarks(marks_obtained, max_marks);

    const existing = await this.prisma.exam_marks.findUnique({
      where: {
        exam_subject_mapping_id_student_id: {
          exam_subject_mapping_id,
          student_id,
        },
      },
    });

    if (existing) {
      throw new ConflictException({
        message: 'Marks for this student and exam subject already exist.',
        errorCode: 'EXAM_MARK_ALREADY_EXISTS',
      });
    }

    try {
      return await this.prisma.exam_marks.create({
        data: {
          exam_subject_mapping_id,
          student_id,
          marks_obtained,
          max_marks,
          entered_by_faculty_id,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'Marks for this student and exam subject already exist.',
          errorCode: 'EXAM_MARK_ALREADY_EXISTS',
        });
      }

      this.logger.error('DB error while creating mark', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll(query: ListExamMarksQueryDto) {
    try {
      return await this.prisma.exam_marks.findMany({
        where: {
          student_id: query.student_id,
          exam_subject_mapping_id: query.exam_subject_mapping_id,
        },
        include: {
          exam_subject_mapping: {
            select: {
              id: true,
              exam_id: true,
              subject_id: true,
              is_published: true,
              published_at: true,
              exams: {
                select: {
                  id: true,
                  academic_year: true,
                  semester: true,
                  exam_types: {
                    select: { name: true, category: true, code: true },
                  },
                },
              },
              subjects: {
                select: { id: true, name: true, subject_code: true },
              },
            },
          },
          students: true,
          faculty: true,
        },
      });
    } catch (err: any) {
      this.logger.error('DB error while fetching marks', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    let mark: any;

    try {
      mark = await this.prisma.exam_marks.findUnique({
        where: { id },
        include: {
          exam_subject_mapping: true,
          students: true,
          faculty: true,
        },
      });
    } catch (err: any) {
      this.logger.error('DB error while fetching mark', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!mark) {
      throw new NotFoundException({
        message: 'Mark not found.',
        errorCode: 'EXAM_MARK_NOT_FOUND',
      });
    }

    return mark;
  }

  async update(id: number, updateMarkDto: UpdateMarkDto) {
    const existing = await this.prisma.exam_marks.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException({
        message: 'Mark not found.',
        errorCode: 'EXAM_MARK_NOT_FOUND',
      });
    }

    if (updateMarkDto.entered_by_faculty_id !== undefined) {
      const faculty = await this.prisma.faculty.findUnique({
        where: { id: updateMarkDto.entered_by_faculty_id },
      });

      if (!faculty) {
        throw new NotFoundException({
          message: 'Faculty not found.',
          errorCode: 'FACULTY_NOT_FOUND',
        });
      }
    }

    const maxMarks = updateMarkDto.max_marks ?? Number(existing.max_marks);
    const marksObtained =
      updateMarkDto.marks_obtained ??
      (existing.marks_obtained !== null
        ? Number(existing.marks_obtained)
        : undefined);

    this.assertValidMarks(marksObtained, maxMarks);

    try {
      return await this.prisma.exam_marks.update({
        where: { id },
        data: {
          marks_obtained: updateMarkDto.marks_obtained,
          max_marks: updateMarkDto.max_marks,
          entered_by_faculty_id: updateMarkDto.entered_by_faculty_id,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'Marks for this student and exam subject already exist.',
          errorCode: 'EXAM_MARK_ALREADY_EXISTS',
        });
      }

      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Mark not found.',
          errorCode: 'EXAM_MARK_NOT_FOUND',
        });
      }

      this.logger.error('DB error while updating mark', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.exam_marks.delete({ where: { id } });
    } catch (err: any) {
      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Mark not found.',
          errorCode: 'EXAM_MARK_NOT_FOUND',
        });
      }

      this.logger.error('DB error while deleting mark', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
