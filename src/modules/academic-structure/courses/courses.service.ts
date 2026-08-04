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
    try {
      return await this.prisma.courses.update({
        where: {
          id,
        },
        data: updateCourseDto,
      });
    } catch (err: any) {
      console.log('COURSE PATCH ERROR 👉', err);

      if (err.code === 'P2025') {
        throw new NotFoundException({
          message: 'Course not found',
          errorCode: 'COURSE_NOT_FOUND',
        });
      }

      if (err.code === 'P2002') {
        throw new ConflictException({
          message: 'Course code already exists',
          errorCode: 'COURSE_CODE_EXISTS',
        });
      }

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
  async remove(id: number) {
    return this.prisma.courses.delete({
      where: {
        id,
      },
    });
  }
}
