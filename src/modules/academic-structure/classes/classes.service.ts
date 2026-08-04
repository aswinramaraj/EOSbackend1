import {
  Injectable,
  ConflictException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import { PrismaService } from 'src/prisma/prisma.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { AssignMentorDto } from './dto/assign-mentor.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

const MENTOR_SELECT = {
  id: true,
  class_id: true,
  faculty_id: true,
  academic_year: true,
  assigned_by_user_id: true,
  faculty: {
    select: { id: true, first_name: true, last_name: true, designation: true },
  },
} as const;

@Injectable()
export class ClassesService {
  private readonly logger = new Logger(ClassesService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(createClassDto: CreateClassDto) {
    const { batch_id, department_id, course_id, section, current_semester } =
      createClassDto;

    const batch = await this.prisma.batches.findUnique({
      where: { id: batch_id },
    });

    if (!batch) {
      throw new NotFoundException({
        message: 'Batch not found',
        errorCode: 'BATCH_NOT_FOUND',
      });
    }

    const department = await this.prisma.departments.findUnique({
      where: { id: department_id },
    });

    if (!department) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    const course = await this.prisma.courses.findUnique({
      where: { id: course_id },
    });

    if (!course) {
      throw new NotFoundException({
        message: 'Course not found',
        errorCode: 'COURSE_NOT_FOUND',
      });
    }

    if (course.department_id !== department_id) {
      throw new ConflictException({
        message:
          'The selected course does not belong to the selected department',
        errorCode: 'COURSE_DEPARTMENT_MISMATCH',
      });
    }

    const existing = await this.prisma.classes.findFirst({
      where: {
        batch_id,
        department_id,
        course_id,
        section,
      },
    });

    if (existing) {
      throw new ConflictException({
        message:
          'A class with this batch, department, course, and section already exists',
        errorCode: 'CLASS_ALREADY_EXISTS',
      });
    }

    try {
      return await this.prisma.classes.create({
        data: {
          batch_id,
          department_id,
          course_id,
          section,
          current_semester,
        },
      });
    } catch (error: any) {
      this.logger.error('DB error while creating class', error);

      if (error.code === 'P2002') {
        throw new ConflictException({
          message:
            'A class with this batch, department, course, and section already exists',
          errorCode: 'CLASS_ALREADY_EXISTS',
        });
      }

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll() {
    try {
      return await this.prisma.classes.findMany();
    } catch (error: any) {
      this.logger.error('DB error while fetching classes', error);

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    const classRecord = await this.prisma.classes.findUnique({
      where: { id },
    });

    if (!classRecord) {
      throw new NotFoundException({
        message: 'Class not found',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    return classRecord;
  }

  async update(id: number, updateClassDto: UpdateClassDto) {
    const existing = await this.prisma.classes.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Class not found',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    const batch_id = updateClassDto.batch_id ?? existing.batch_id;

    const department_id =
      updateClassDto.department_id ?? existing.department_id;

    const course_id = updateClassDto.course_id ?? existing.course_id;

    const section = updateClassDto.section ?? existing.section;

    const course = await this.prisma.courses.findUnique({
      where: { id: course_id },
    });

    if (!course) {
      throw new NotFoundException({
        message: 'Course not found',
        errorCode: 'COURSE_NOT_FOUND',
      });
    }

    if (course.department_id !== department_id) {
      throw new ConflictException({
        message:
          'The selected course does not belong to the selected department',
        errorCode: 'COURSE_DEPARTMENT_MISMATCH',
      });
    }

    const duplicate = await this.prisma.classes.findFirst({
      where: {
        id: {
          not: id,
        },
        batch_id,
        department_id,
        course_id,
        section,
      },
    });

    if (duplicate) {
      throw new ConflictException({
        message:
          'A class with this batch, department, course, and section already exists',
        errorCode: 'CLASS_ALREADY_EXISTS',
      });
    }

    try {
      return await this.prisma.classes.update({
        where: { id },

        data: {
          batch_id,
          department_id,
          course_id,
          section,
          current_semester: updateClassDto.current_semester,
        },
      });
    } catch (error: any) {
      this.logger.error('DB error while updating class', error);

      if (error.code === 'P2002') {
        throw new ConflictException({
          message:
            'A class with this batch, department, course, and section already exists',
          errorCode: 'CLASS_ALREADY_EXISTS',
        });
      }

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async remove(id: number) {
    try {
      return await this.prisma.classes.delete({
        where: { id },
      });
    } catch (error: any) {
      if (error.code === 'P2025') {
        throw new NotFoundException({
          message: 'Class not found',
          errorCode: 'CLASS_NOT_FOUND',
        });
      }

      this.logger.error('DB error while deleting class', error);

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
