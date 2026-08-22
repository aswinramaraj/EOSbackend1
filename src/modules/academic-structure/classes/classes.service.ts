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
import { MentorQueryDto } from './dto/mentor-query.dto';

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

    this.assertSemesterInRange(current_semester, course.duration_years);

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
    } catch (error: unknown) {
      this.logger.error('DB error while creating class', error);

      if (prismaErrorCode(error) === 'P2002') {
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

    const nextSemester =
      updateClassDto.current_semester ?? existing.current_semester;
    this.assertSemesterInRange(nextSemester, course.duration_years);

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
    } catch (error: unknown) {
      this.logger.error('DB error while updating class', error);

      if (prismaErrorCode(error) === 'P2002') {
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

  /**
   * GET /classes/:id/mentor — omit academic_year for the full assignment
   * history (ordered most-recent academic_year first); pass academic_year to
   * scope to that one year. `class_mentors` has @@unique([class_id,
   * academic_year]), so at most one row comes back per requested year.
   */
  async findMentor(classId: number, query: MentorQueryDto) {
    const classRecord = await this.prisma.classes.findUnique({
      where: { id: classId },
    });
    if (!classRecord) {
      throw new NotFoundException({
        message: 'Class not found',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    return this.prisma.class_mentors.findMany({
      where: {
        class_id: classId,
        ...(query.academic_year && { academic_year: query.academic_year }),
      },
      select: MENTOR_SELECT,
      orderBy: { academic_year: 'desc' },
    });
  }

  /**
   * DELETE /classes/:id
   *
   * Blocked (409 CLASS_IN_USE) if any student is currently assigned to this
   * class — reports the exact count so the UI can show it before the click.
   */
  async remove(id: number) {
    const existing = await this.prisma.classes.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({
        message: 'Class not found',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    const studentCount = await this.prisma.students.count({
      where: { class_id: id },
    });

    if (studentCount > 0) {
      throw new ConflictException({
        message: `Cannot delete — ${studentCount} student(s) are in this class. Move them first.`,
        errorCode: 'CLASS_IN_USE',
        details: { students: studentCount },
      });
    }

    try {
      await this.prisma.classes.delete({ where: { id } });
      return { message: 'Class deleted successfully' };
    } catch (error: unknown) {
      if (prismaErrorCode(error) === 'P2003') {
        throw new ConflictException({
          message: 'Class cannot be deleted while other records reference it',
          errorCode: 'CLASS_IN_USE',
        });
      }

      this.logger.error('DB error while deleting class', error);

      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /classes/:id/subjects — read-only view of this class's assigned
   * subjects for the current/each semester (class_subjects), for the
   * Academic Structure class detail panel. Does not create/modify
   * class_subjects rows — that assignment flow lives with the HoD-facing
   * faculty-mapping module, out of scope here.
   */
  async subjectsForClass(classId: number) {
    const classRecord = await this.prisma.classes.findUnique({
      where: { id: classId },
    });
    if (!classRecord) {
      throw new NotFoundException({
        message: 'Class not found',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    return this.prisma.class_subjects.findMany({
      where: { class_id: classId },
      select: {
        id: true,
        semester: true,
        is_elective: true,
        subjects: {
          select: { id: true, name: true, subject_code: true, credits: true },
        },
      },
      orderBy: [{ semester: 'asc' }, { id: 'asc' }],
    });
  }

  /** Reference's own rule: current_semester must fit within the course's actual length (duration_years * 2 semesters). */
  private assertSemesterInRange(
    semester: number | null | undefined,
    durationYears: number,
  ): void {
    if (semester == null) return;
    const maxSemester = durationYears * 2;
    if (semester < 1 || semester > maxSemester) {
      throw new ConflictException({
        message: `current_semester must be between 1 and ${maxSemester} for this course`,
        errorCode: 'INVALID_SEMESTER',
      });
    }
  }
}
