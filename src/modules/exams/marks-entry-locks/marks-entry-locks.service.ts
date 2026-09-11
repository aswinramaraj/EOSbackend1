import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { FindMarksEntryLocksQueryDto } from './dto/find-marks-entry-locks-query.dto';
import { SetMarksEntryLockDto } from './dto/set-marks-entry-lock.dto';

@Injectable()
export class MarksEntryLocksService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: FindMarksEntryLocksQueryDto) {
    return this.prisma.marks_entry_locks.findMany({
      where: { exam_id: query.exam_id, department_id: query.department_id },
    });
  }

  /** Upserts the (exam_id, department_id) lock row — the table's own unique constraint. */
  async setLock(dto: SetMarksEntryLockDto, userId: number) {
    return this.prisma.marks_entry_locks.upsert({
      where: { exam_id_department_id: { exam_id: dto.exam_id, department_id: dto.department_id } },
      create: {
        exam_id: dto.exam_id,
        department_id: dto.department_id,
        is_locked: dto.is_locked,
        locked_by_user_id: userId,
        locked_at: new Date(),
      },
      update: {
        is_locked: dto.is_locked,
        locked_by_user_id: userId,
        locked_at: new Date(),
      },
    });
  }
}
