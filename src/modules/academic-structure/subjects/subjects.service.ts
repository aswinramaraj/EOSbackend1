// subjects/subjects.service.ts
import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateSubjectDto } from './dto/create-subject.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

@Injectable()
export class SubjectsService {
  private readonly logger = new Logger(SubjectsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(createSubjectDto: CreateSubjectDto) {
    const existing = await this.prisma.subjects.findUnique({
      where: { subject_code: createSubjectDto.subject_code },
    });

    if (existing) {
      throw new ConflictException({
        message: 'Subject code already exists',
        errorCode: 'SUBJECT_CODE_EXISTS',
      });
    }

    try {
      return await this.prisma.subjects.create({
        data: {
          name: createSubjectDto.name,
          subject_code: createSubjectDto.subject_code,
          department_id: createSubjectDto.department_id,
          credits: createSubjectDto.credits,
          short_code: createSubjectDto.short_code,
          course_type: createSubjectDto.course_type,
          category: createSubjectDto.category,
          hours: createSubjectDto.hours,
          semester: createSubjectDto.semester,
        },
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException({
          message: 'Subject code already exists',
          errorCode: 'SUBJECT_CODE_EXISTS',
        });
      }

      this.logger.error('DB error while creating subject', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll() {
    try {
      return await this.prisma.subjects.findMany();
    } catch (err: unknown) {
      this.logger.error('DB error while fetching subjects', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    let subject: Awaited<ReturnType<typeof this.prisma.subjects.findUnique>>;

    try {
      subject = await this.prisma.subjects.findUnique({ where: { id } });
    } catch (err: unknown) {
      this.logger.error('DB error while fetching subject', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!subject) {
      throw new NotFoundException({
        message: 'Subject not found',
        errorCode: 'SUBJECT_NOT_FOUND',
      });
    }

    return subject;
  }

  async update(id: number, updateSubjectDto: UpdateSubjectDto) {
    const existing = await this.prisma.subjects.findUnique({ where: { id } });

    if (!existing) {
      throw new NotFoundException({
        message: 'Subject not found',
        errorCode: 'SUBJECT_NOT_FOUND',
      });
    }

    if (
      updateSubjectDto.subject_code &&
      updateSubjectDto.subject_code !== existing.subject_code
    ) {
      const codeTaken = await this.prisma.subjects.findUnique({
        where: { subject_code: updateSubjectDto.subject_code },
      });

      if (codeTaken) {
        throw new ConflictException({
          message: 'Subject code already exists',
          errorCode: 'SUBJECT_CODE_EXISTS',
        });
      }
    }

    try {
      return await this.prisma.subjects.update({
        where: { id },
        data: {
          name: updateSubjectDto.name,
          subject_code: updateSubjectDto.subject_code,
          department_id: updateSubjectDto.department_id,
          credits: updateSubjectDto.credits,
          short_code: updateSubjectDto.short_code,
          course_type: updateSubjectDto.course_type,
          category: updateSubjectDto.category,
          hours: updateSubjectDto.hours,
          semester: updateSubjectDto.semester,
        },
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException({
          message: 'Subject code already exists',
          errorCode: 'SUBJECT_CODE_EXISTS',
        });
      }

      if (prismaErrorCode(err) === 'P2025') {
        throw new NotFoundException({
          message: 'Subject not found',
          errorCode: 'SUBJECT_NOT_FOUND',
        });
      }

      this.logger.error('DB error while updating subject', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number) {
    try {
      return await this.prisma.subjects.delete({ where: { id } });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2025') {
        throw new NotFoundException({
          message: 'Subject not found',
          errorCode: 'SUBJECT_NOT_FOUND',
        });
      }

      if (prismaErrorCode(err) === 'P2003') {
        throw new ConflictException({
          message:
            'Cannot delete — this course is already mapped to classes or has activity recorded against it.',
          errorCode: 'SUBJECT_IN_USE',
        });
      }

      this.logger.error('DB error while deleting subject', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
