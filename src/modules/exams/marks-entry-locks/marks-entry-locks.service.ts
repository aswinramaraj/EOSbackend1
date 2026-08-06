import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { QueryMarksEntryLockDto } from './dto/query-marks-entry-lock.dto';
import { UpdateMarksEntryLockDto } from './dto/update-marks-entry-lock.dto';

function toResponse(
  examId: number,
  departmentId: number,
  row: {
    is_locked: boolean;
    locked_at: Date | null;
    is_published: boolean;
    published_at: Date | null;
  } | null,
) {
  return {
    exam_id: examId,
    department_id: departmentId,
    is_locked: row?.is_locked ?? false,
    locked_at: row?.locked_at ?? null,
    is_published: row?.is_published ?? false,
    published_at: row?.published_at ?? null,
  };
}

@Injectable()
export class MarksEntryLocksService {
  private readonly logger = new Logger(MarksEntryLocksService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async assertExamAndDepartmentExist(
    examId: number,
    departmentId: number,
  ) {
    const exam = await this.prisma.exams.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const department = await this.prisma.departments.findUnique({
      where: { id: departmentId },
    });
    if (!department) {
      throw new NotFoundException({
        message: 'Department not found.',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }
  }

  async find(query: QueryMarksEntryLockDto) {
    await this.assertExamAndDepartmentExist(query.exam_id, query.department_id);

    try {
      const row = await this.prisma.marks_entry_locks.findUnique({
        where: {
          exam_id_department_id: {
            exam_id: query.exam_id,
            department_id: query.department_id,
          },
        },
      });
      return toResponse(query.exam_id, query.department_id, row);
    } catch (err) {
      this.logger.error('DB error while fetching marks entry lock', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async setLock(
    query: QueryMarksEntryLockDto,
    dto: UpdateMarksEntryLockDto,
    userId: number,
  ) {
    await this.assertExamAndDepartmentExist(query.exam_id, query.department_id);

    try {
      const row = await this.prisma.marks_entry_locks.upsert({
        where: {
          exam_id_department_id: {
            exam_id: query.exam_id,
            department_id: query.department_id,
          },
        },
        create: {
          exam_id: query.exam_id,
          department_id: query.department_id,
          is_locked: dto.is_locked,
          locked_by_user_id: dto.is_locked ? userId : undefined,
          locked_at: dto.is_locked ? new Date() : undefined,
        },
        update: {
          is_locked: dto.is_locked,
          locked_by_user_id: dto.is_locked ? userId : null,
          locked_at: dto.is_locked ? new Date() : null,
        },
      });
      return toResponse(query.exam_id, query.department_id, row);
    } catch (err) {
      this.logger.error('DB error while updating marks entry lock', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /** Senior-COE only (enforced at the controller). Requires the entry to already be locked. */
  async publish(query: QueryMarksEntryLockDto, userId: number) {
    await this.assertExamAndDepartmentExist(query.exam_id, query.department_id);

    const existing = await this.prisma.marks_entry_locks.findUnique({
      where: {
        exam_id_department_id: {
          exam_id: query.exam_id,
          department_id: query.department_id,
        },
      },
    });

    if (!existing?.is_locked) {
      throw new BadRequestException({
        message: 'Marks entry must be locked before it can be published.',
        errorCode: 'MARKS_ENTRY_NOT_LOCKED',
      });
    }

    try {
      const row = await this.prisma.marks_entry_locks.update({
        where: { id: existing.id },
        data: {
          is_published: true,
          published_by_user_id: userId,
          published_at: new Date(),
        },
      });
      return toResponse(query.exam_id, query.department_id, row);
    } catch (err) {
      this.logger.error('DB error while publishing marks entry lock', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
