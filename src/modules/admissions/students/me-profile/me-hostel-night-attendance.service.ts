import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetHostelNightAttendanceDto } from './dto/get-hostel-night-attendance.dto';

interface NightAttendanceRow {
  id: number;
  attendance_date: Date;
  status: 'present' | 'absent';
  marked_at: Date;
  published_at: Date | null;
}

/**
 * GET /me/hostel-night-attendance
 *
 * Self-scoped: student_id resolved from the JWT. Reads the same
 * hostel_night_attendance table the warden's NightAttendanceService writes
 * (see src/modules/hostel/night-attendance) - only PUBLISHED rows
 * (is_published=true) are ever returned, since a draft mark is the warden's
 * own working sheet for the night, not yet a finalized record a student
 * should see. `is_hostel_resident: false` (empty records) is a normal
 * response for a day scholar, not an error - same convention as
 * MeHostelRoomService.
 */
@Injectable()
export class MeHostelNightAttendanceService {
  private readonly logger = new Logger(MeHostelNightAttendanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getMyNightAttendance(userId: number, query: GetHostelNightAttendanceDto = {}) {
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

    return this.getNightAttendanceForStudentId(student.id, userId, query);
  }

  /**
   * Studentid-keyed core, factored out so ParentsService can render a
   * parent's own child's night attendance (see
   * ParentsService.getChildNightAttendance) without re-deriving student_id
   * from a JWT that belongs to the parent, not the student.
   */
  async getNightAttendanceForStudentId(
    studentId: number,
    userIdForLogging: number,
    query: GetHostelNightAttendanceDto = {},
  ) {
    const mapping = await this.prisma.student_hostel_mapping.findUnique({
      where: { student_id: studentId },
      select: { student_id: true },
    });
    if (!mapping) {
      return { is_hostel_resident: false, records: [] };
    }

    try {
      const rows = query.from && query.to
        ? await this.prisma.$queryRaw<NightAttendanceRow[]>`
            SELECT id, attendance_date, status, marked_at, published_at
            FROM hostel_night_attendance
            WHERE student_id = ${studentId} AND is_published = true
              AND attendance_date BETWEEN ${query.from}::date AND ${query.to}::date
            ORDER BY attendance_date DESC
          `
        : await this.prisma.$queryRaw<NightAttendanceRow[]>`
            SELECT id, attendance_date, status, marked_at, published_at
            FROM hostel_night_attendance
            WHERE student_id = ${studentId} AND is_published = true
            ORDER BY attendance_date DESC
            LIMIT 90
          `;
      return {
        is_hostel_resident: true,
        records: rows.map((r) => ({
          id: r.id,
          date: r.attendance_date,
          status: r.status,
          marked_at: r.marked_at,
          published_at: r.published_at,
        })),
      };
    } catch (err) {
      this.logger.error(`Failed to fetch night attendance for user ${userIdForLogging}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
