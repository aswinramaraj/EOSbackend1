import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCourseDto } from './dto/create-course.dto';
import { UpdateCourseDto } from './dto/update-course.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

@Injectable()
export class CoursesService {
  private readonly logger = new Logger(CoursesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /courses
   *
   * Error cases:
   *  404 DEPARTMENT_NOT_FOUND – department_id doesn't exist
   *  409 COURSE_CODE_EXISTS   – code already in use
   *  500 INTERNAL_ERROR       – unexpected DB failure
   */
  async create(createCourseDto: CreateCourseDto) {
    const existing = await this.prisma.courses.findUnique({
      where: {
        code: createCourseDto.code,
      },
    });

    if (existing) {
      throw new ConflictException({
        message: 'Course code already exists',
        errorCode: 'COURSE_CODE_EXISTS',
      });
    }

    const department = await this.prisma.departments.findUnique({
      where: {
        id: createCourseDto.department_id,
      },
    });

    if (!department) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.courses.create({
        data: {
          name: createCourseDto.name,
          code: createCourseDto.code,
          department_id: createCourseDto.department_id,
          duration_years: createCourseDto.duration_years,
        },
      });
    } catch (err: any) {
      this.logger.error('Course create error', err);

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll() {
    return this.prisma.courses.findMany();
  }

  async findOne(id: number) {
    return this.prisma.courses.findUnique({
      where: {
        id,
      },
    });
  }

  async update(id: number, updateCourseDto: UpdateCourseDto) {
    const existing = await this.prisma.courses.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Course not found',
        errorCode: 'COURSE_NOT_FOUND',
      });
    }

    if (
      updateCourseDto.department_id != null &&
      updateCourseDto.department_id !== existing.department_id
    ) {
      const department = await this.prisma.departments.findUnique({
        where: { id: updateCourseDto.department_id },
      });
      if (!department) {
        throw new NotFoundException({
          message: 'Department not found',
          errorCode: 'DEPARTMENT_NOT_FOUND',
        });
      }
    }

    try {
      return await this.prisma.courses.update({
        where: {
          id,
        },
        data: updateCourseDto,
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2025') {
        throw new NotFoundException({
          message: 'Course not found',
          errorCode: 'COURSE_NOT_FOUND',
        });
      }

      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException({
          message: 'Course code already exists',
          errorCode: 'COURSE_CODE_EXISTS',
        });
      }

      this.logger.error(`DB error while updating course #${id}`, err);

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /courses/:id
   *
   * Blocked (409 COURSE_IN_USE) if any class still references this course —
   * reports the exact blocking count so the UI can show it before the click.
   */
  async remove(id: number) {
    const existing = await this.prisma.courses.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Course not found',
        errorCode: 'COURSE_NOT_FOUND',
      });
    }

    const classCount = await this.prisma.classes.count({
      where: { course_id: id },
    });

    if (classCount > 0) {
      throw new ConflictException({
        message: `Cannot delete — still in use by ${classCount} class(es). Remove those first.`,
        errorCode: 'COURSE_IN_USE',
        details: { classes: classCount },
      });
    }

    try {
      await this.prisma.courses.delete({ where: { id } });
      return { message: 'Course deleted successfully' };
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2003') {
        throw new ConflictException({
          message: 'Course cannot be deleted while other records reference it',
          errorCode: 'COURSE_IN_USE',
        });
      }

      this.logger.error(`DB error while deleting course #${id}`, err);

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
