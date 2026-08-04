import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateExamDto } from './dto/create-exam.dto';
import { UpdateExamDto } from './dto/update-exam.dto';

@Injectable()
export class ExamsService {
  private readonly logger = new Logger(ExamsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(createExamDto: CreateExamDto, createdByUserId: number) {
    const { exam_type_id, batch_id, academic_year, semester } = createExamDto;

    const examType = await this.prisma.exam_types.findUnique({
      where: { id: exam_type_id },
    });

    if (!examType) {
      throw new NotFoundException({
        message: 'Exam type not found',
        errorCode: 'EXAM_TYPE_NOT_FOUND',
      });
    }

    const batch = await this.prisma.batches.findUnique({
      where: { id: batch_id },
    });

    if (!batch) {
      throw new NotFoundException({
        message: 'Batch not found',
        errorCode: 'BATCH_NOT_FOUND',
      });
    }

    const duplicate = await this.prisma.exams.findFirst({
      where: {
        exam_type_id,
        batch_id,
        academic_year,
        semester,
      },
    });

    if (duplicate) {
      throw new ConflictException({
        message:
          'An exam with this exam type, batch, academic year, and semester already exists',
        errorCode: 'EXAM_ALREADY_EXISTS',
      });
    }

    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const exam = await tx.exams.create({
          data: {
            exam_type_id,
            batch_id,
            academic_year,
            semester,
            created_by_user_id: createdByUserId,
          },
        });

        const classes = await tx.classes.findMany({
          where: {
            batch_id,
          },
          select: {
            id: true,
          },
        });

        const classIds = classes.map((c) => c.id);

        const classSubjects =
          classIds.length > 0
            ? await tx.class_subjects.findMany({
                where: {
                  class_id: {
                    in: classIds,
                  },
                  semester,
                },
                select: {
                  class_id: true,
                  subject_id: true,
                },
              })
            : [];

        if (classSubjects.length === 0) {
          throw new BadRequestException({
            message: 'No subjects found to map for this batch and semester',
            errorCode: 'NO_SUBJECTS_TO_MAP',
          });
        }

        await tx.exam_subject_mapping.createMany({
          data: classSubjects.map((cs) => ({
            exam_id: exam.id,
            class_id: cs.class_id,
            subject_id: cs.subject_id,
          })),
        });

        return {
          exam,
          subjectMappingsCreated: classSubjects.length,
        };
      });

      return {
        id: result.exam.id,
        exam_type: examType.name,
        batch_id: result.exam.batch_id,
        semester: result.exam.semester,
        status: result.exam.status,
        subject_mappings_created: result.subjectMappingsCreated,
      };
    } catch (err: any) {
      if (
        err instanceof BadRequestException ||
        err instanceof ConflictException ||
        err instanceof NotFoundException
      ) {
        throw err;
      }

      if (err?.code === 'P2002') {
        throw new ConflictException({
          message:
            'An exam with this exam type, batch, academic year, and semester already exists',
          errorCode: 'EXAM_ALREADY_EXISTS',
        });
      }

      this.logger.error('DB error while creating exam', err);

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll() {
    try {
      return await this.prisma.exams.findMany();
    } catch (err: any) {
      this.logger.error('DB error while fetching exams', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    let exam: any;

    try {
      exam = await this.prisma.exams.findUnique({ where: { id } });
    } catch (err: any) {
      this.logger.error('DB error while fetching exam', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    return exam;
  }

  async update(id: number, updateExamDto: UpdateExamDto) {
    const existing = await this.prisma.exams.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException({
        message: 'Exam not found',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.exams.update({
        where: { id },
        data: {
          exam_type_id: updateExamDto.exam_type_id,
          batch_id: updateExamDto.batch_id,
          academic_year: updateExamDto.academic_year,
          semester: updateExamDto.semester,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Exam not found',
          errorCode: 'EXAM_NOT_FOUND',
        });
      }

      this.logger.error('DB error while updating exam', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number) {
    try {
      return await this.prisma.exams.delete({ where: { id } });
    } catch (err: any) {
      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Exam not found',
          errorCode: 'EXAM_NOT_FOUND',
        });
      }

      this.logger.error('DB error while deleting exam', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
