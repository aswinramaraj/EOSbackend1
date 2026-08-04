import {
  Injectable,
  NotFoundException,
  ConflictException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateExamSubjectMappingDto } from './dto/create-exam-subject-mapping.dto';
import { UpdateExamSubjectMappingDto } from './dto/update-exam-subject-mapping.dto';

@Injectable()
export class ExamSubjectMappingService {
  private readonly logger = new Logger(ExamSubjectMappingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(createExamSubjectMappingDto: CreateExamSubjectMappingDto) {
    const { exam_id, class_id } = createExamSubjectMappingDto;

    const exam = await this.prisma.exams.findUnique({ where: { id: exam_id } });

    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const classRecord = await this.prisma.classes.findUnique({
      where: { id: class_id },
    });

    if (!classRecord) {
      throw new NotFoundException({
        message: 'Class not found.',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    const classSubjects = await this.prisma.class_subjects.findMany({
      where: { class_id },
      select: { subject_id: true },
    });

    if (classSubjects.length === 0) {
      throw new NotFoundException({
        message: 'Subjects are not assigned to this class.',
        errorCode: 'CLASS_SUBJECTS_NOT_FOUND',
      });
    }

    const existingMapping = await this.prisma.exam_subject_mapping.findFirst({
      where: { exam_id, class_id },
    });

    if (existingMapping) {
      throw new ConflictException({
        message: 'Subjects are already mapped for this exam and class.',
        errorCode: 'EXAM_SUBJECT_MAPPING_EXISTS',
      });
    }

    try {
      const totalSubjects = await this.prisma.$transaction(async (tx) => {
        let count = 0;

        for (const classSubject of classSubjects) {
          await tx.exam_subject_mapping.create({
            data: {
              exam_id,
              class_id,
              subject_id: classSubject.subject_id,
            },
          });
          count++;
        }

        return count;
      });

      return { exam_id, class_id, total_subjects: totalSubjects };
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'Subjects are already mapped for this exam and class.',
          errorCode: 'EXAM_SUBJECT_MAPPING_EXISTS',
        });
      }

      this.logger.error('DB error while mapping exam subjects', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll() {
    try {
      return await this.prisma.exam_subject_mapping.findMany();
    } catch (err: any) {
      this.logger.error('DB error while fetching exam subject mappings', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    let mapping: any;

    try {
      mapping = await this.prisma.exam_subject_mapping.findUnique({
        where: { id },
      });
    } catch (err: any) {
      this.logger.error('DB error while fetching exam subject mapping', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!mapping) {
      throw new NotFoundException({
        message: 'Exam subject mapping not found.',
        errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
      });
    }

    return mapping;
  }

  async update(
    id: number,
    updateExamSubjectMappingDto: UpdateExamSubjectMappingDto,
  ) {
    const existing = await this.prisma.exam_subject_mapping.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Exam subject mapping not found.',
        errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
      });
    }

    const exam_id = updateExamSubjectMappingDto.exam_id ?? existing.exam_id;
    const class_id = updateExamSubjectMappingDto.class_id ?? existing.class_id;
    const subject_id =
      updateExamSubjectMappingDto.subject_id ?? existing.subject_id;

    if (updateExamSubjectMappingDto.exam_id !== undefined) {
      const exam = await this.prisma.exams.findUnique({
        where: { id: updateExamSubjectMappingDto.exam_id },
      });

      if (!exam) {
        throw new NotFoundException({
          message: 'Exam not found.',
          errorCode: 'EXAM_NOT_FOUND',
        });
      }
    }

    if (updateExamSubjectMappingDto.class_id !== undefined) {
      const classRecord = await this.prisma.classes.findUnique({
        where: { id: updateExamSubjectMappingDto.class_id },
      });

      if (!classRecord) {
        throw new NotFoundException({
          message: 'Class not found.',
          errorCode: 'CLASS_NOT_FOUND',
        });
      }
    }

    if (updateExamSubjectMappingDto.subject_id !== undefined) {
      const subject = await this.prisma.subjects.findUnique({
        where: { id: updateExamSubjectMappingDto.subject_id },
      });

      if (!subject) {
        throw new NotFoundException({
          message: 'Subject not found.',
          errorCode: 'SUBJECT_NOT_FOUND',
        });
      }
    }

    if (
      updateExamSubjectMappingDto.exam_id !== undefined ||
      updateExamSubjectMappingDto.class_id !== undefined ||
      updateExamSubjectMappingDto.subject_id !== undefined
    ) {
      const duplicate = await this.prisma.exam_subject_mapping.findFirst({
        where: { id: { not: id }, exam_id, class_id, subject_id },
      });

      if (duplicate) {
        throw new ConflictException({
          message:
            'This exam, class, and subject combination is already mapped.',
          errorCode: 'EXAM_SUBJECT_MAPPING_EXISTS',
        });
      }
    }

    try {
      return await this.prisma.exam_subject_mapping.update({
        where: { id },
        data: {
          exam_id: updateExamSubjectMappingDto.exam_id,
          class_id: updateExamSubjectMappingDto.class_id,
          subject_id: updateExamSubjectMappingDto.subject_id,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message:
            'This exam, class, and subject combination is already mapped.',
          errorCode: 'EXAM_SUBJECT_MAPPING_EXISTS',
        });
      }

      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Exam subject mapping not found.',
          errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
        });
      }

      this.logger.error('DB error while updating exam subject mapping', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number) {
    try {
      await this.prisma.exam_subject_mapping.delete({ where: { id } });
    } catch (err: any) {
      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Exam subject mapping not found.',
          errorCode: 'EXAM_SUBJECT_MAPPING_NOT_FOUND',
        });
      }

      this.logger.error('DB error while deleting exam subject mapping', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
