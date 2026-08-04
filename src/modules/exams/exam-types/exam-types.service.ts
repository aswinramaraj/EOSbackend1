import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateExamTypeDto } from './dto/create-exam-type.dto';
import { UpdateExamTypeDto } from './dto/update-exam-type.dto';

@Injectable()
export class ExamTypesService {
  private readonly logger = new Logger(ExamTypesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(createExamTypeDto: CreateExamTypeDto) {
    const existing = await this.prisma.exam_types.findFirst({
      where: { name: { equals: createExamTypeDto.name, mode: 'insensitive' } },
    });

    if (existing) {
      throw new ConflictException({
        message: 'Exam Type already exists.',
        errorCode: 'EXAM_TYPE_EXISTS',
      });
    }

    try {
      return await this.prisma.exam_types.create({
        data: { name: createExamTypeDto.name },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'Exam Type already exists.',
          errorCode: 'EXAM_TYPE_EXISTS',
        });
      }

      this.logger.error('DB error while creating exam type', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll() {
    try {
      return await this.prisma.exam_types.findMany();
    } catch (err: any) {
      this.logger.error('DB error while fetching exam types', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    let examType: any;

    try {
      examType = await this.prisma.exam_types.findUnique({ where: { id } });
    } catch (err: any) {
      this.logger.error('DB error while fetching exam type', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!examType) {
      throw new NotFoundException({
        message: 'Exam Type not found.',
        errorCode: 'EXAM_TYPE_NOT_FOUND',
      });
    }

    return examType;
  }

  async update(id: number, updateExamTypeDto: UpdateExamTypeDto) {
    const existing = await this.prisma.exam_types.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException({
        message: 'Exam Type not found.',
        errorCode: 'EXAM_TYPE_NOT_FOUND',
      });
    }

    if (updateExamTypeDto.name) {
      const duplicate = await this.prisma.exam_types.findFirst({
        where: {
          id: { not: id },
          name: { equals: updateExamTypeDto.name, mode: 'insensitive' },
        },
      });

      if (duplicate) {
        throw new ConflictException({
          message: 'Exam Type already exists.',
          errorCode: 'EXAM_TYPE_EXISTS',
        });
      }
    }

    try {
      return await this.prisma.exam_types.update({
        where: { id },
        data: { name: updateExamTypeDto.name },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException({
          message: 'Exam Type already exists.',
          errorCode: 'EXAM_TYPE_EXISTS',
        });
      }

      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Exam Type not found.',
          errorCode: 'EXAM_TYPE_NOT_FOUND',
        });
      }

      this.logger.error('DB error while updating exam type', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number) {
    const existing = await this.prisma.exam_types.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException({
        message: 'Exam Type not found.',
        errorCode: 'EXAM_TYPE_NOT_FOUND',
      });
    }

    const inUse = await this.prisma.exams.findFirst({
      where: { exam_type_id: id },
    });

    if (inUse) {
      throw new ConflictException({
        message: 'Exam Type is already assigned to one or more exams.',
        errorCode: 'EXAM_TYPE_IN_USE',
      });
    }

    try {
      await this.prisma.exam_types.delete({ where: { id } });
    } catch (err: any) {
      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Exam Type not found.',
          errorCode: 'EXAM_TYPE_NOT_FOUND',
        });
      }

      if (err?.code === 'P2003') {
        throw new ConflictException({
          message: 'Exam Type is already assigned to one or more exams.',
          errorCode: 'EXAM_TYPE_IN_USE',
        });
      }

      this.logger.error('DB error while deleting exam type', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
