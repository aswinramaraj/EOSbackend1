import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetAttendanceDto } from './dto/get-attendance.dto';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class MeAttendanceService {
  private readonly logger = new Logger(MeAttendanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/attendance
   *
   * Self-scoped: student_id resolved from the JWT. Aggregates raw
   * `attendance_records` into an overall summary, a per-subject breakdown
   * (excluding subject_id: null rows — a whole-day mark with no specific
   * subject, per the schema's nullable column), and the raw day-by-day list.
   *
   * Error cases:
   *  400 VALIDATION_ERROR   – from > to
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student record
   *                           (same defensive check as the sibling /me/profile
   *                           endpoints, kept for consistency — the spec marks
   *                           this "not applicable" but it never fires for a
   *                           real, correctly-provisioned student account)
   *  404 SUBJECT_NOT_FOUND  – subject_id provided but doesn't exist
   *  500 INTERNAL_ERROR     – unexpected DB failure
   */
  async getMyAttendance(userId: number, dto: GetAttendanceDto) {
    this.validateDateRange(dto);

    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    return this.computeAttendance(student.id, dto);
  }

  /**
   * Same computation as getMyAttendance, but for a student chosen by id
   * rather than resolved from the caller's own JWT - used by ParentsService
   * once it has verified (via parent_student_mapping) that the caller is
   * actually this student's parent.
   */
  async getAttendanceForStudentId(studentId: number, dto: GetAttendanceDto) {
    this.validateDateRange(dto);
    return this.computeAttendance(studentId, dto);
  }

  private validateDateRange(dto: GetAttendanceDto) {
    if (new Date(dto.from) > new Date(dto.to)) {
      throw new BadRequestException({
        message:
          'from and to are required and from must be before or equal to to',
        errorCode: 'VALIDATION_ERROR',
      });
    }
  }

  private async computeAttendance(studentId: number, dto: GetAttendanceDto) {
    if (dto.subject_id !== undefined) {
      const subject = await this.prisma.subjects.findUnique({
        where: { id: dto.subject_id },
      });
      if (!subject) {
        throw new NotFoundException({
          message: 'Subject not found',
          errorCode: 'SUBJECT_NOT_FOUND',
        });
      }
    }

    const records = await this.fetchAttendanceRecords(studentId, dto);

    const total_days = records.length;
    const present = records.filter((r) => r.status === 'present').length;
    const absent = records.filter((r) => r.status === 'absent').length;

    const bySubject = new Map<
      number,
      { subject_name: string; total: number; present: number }
    >();
    for (const record of records) {
      if (record.subject_id === null) continue;
      const entry = bySubject.get(record.subject_id) ?? {
        subject_name: record.subjects?.name ?? '',
        total: 0,
        present: 0,
      };
      entry.total += 1;
      if (record.status === 'present') entry.present += 1;
      bySubject.set(record.subject_id, entry);
    }

    return {
      overall: {
        total_days,
        present,
        absent,
        percentage: total_days > 0 ? round2((present / total_days) * 100) : 0,
      },
      by_subject: Array.from(bySubject.entries()).map(
        ([subject_id, entry]) => ({
          subject_id,
          subject_name: entry.subject_name,
          total: entry.total,
          present: entry.present,
          percentage: round2((entry.present / entry.total) * 100),
        }),
      ),
      records: records.map((record) => ({
        attendance_date: toDateOnly(record.attendance_date),
        subject_id: record.subject_id,
        status: record.status,
      })),
    };
  }

  private async fetchAttendanceRecords(
    studentId: number,
    dto: GetAttendanceDto,
  ) {
    try {
      return await this.prisma.attendance_records.findMany({
        where: {
          student_id: studentId,
          attendance_date: { gte: new Date(dto.from), lte: new Date(dto.to) },
          ...(dto.subject_id !== undefined
            ? { subject_id: dto.subject_id }
            : {}),
        },
        select: {
          attendance_date: true,
          subject_id: true,
          status: true,
          subjects: { select: { name: true } },
        },
        orderBy: { attendance_date: 'asc' },
      });
    } catch (err) {
      this.logger.error(`Failed to fetch attendance for student ${studentId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
