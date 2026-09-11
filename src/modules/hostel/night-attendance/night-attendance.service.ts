import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from 'generated/prisma/client';
import { formatStudentName } from '../common/student-name.util';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';

interface RosterRow {
  student_id: number;
  first_name: string | null;
  last_name: string | null;
  email: string;
  roll: string;
  room_number: string;
  marked_status: 'present' | 'absent' | null;
  /** True while this mark has been saved but not yet published. */
  is_draft: boolean;
  on_leave: boolean;
}

/**
 * Roll call is taken as a working sheet and then published, the same way
 * faculty class attendance is.
 *
 * Publication state lives in `is_published` / `published_at`, the same pair
 * faculty class attendance already uses on `attendance_records`, so roll call
 * behaves like class attendance instead of inventing a second pattern. The
 * `status` column keeps its existing CHECK of 'present'/'absent' — a draft is
 * not a third status, it is an unpublished one — so every other reader of this
 * table is unaffected.
 *
 * Each date is an independent sheet, so the warden takes and publishes a fresh
 * roll call every night with no carry-over from the previous day.
 *
 * Requires prisma/migrations/hostel_night_attendance_publish.sql.
 */

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Manual night roll call — hostel_night_attendance is a hand-written table
 * (not in schema.prisma), accessed only via raw SQL. There's no biometric
 * scanner integration anywhere in this codebase, so this models the real
 * fallback: the warden marks each resident present/absent once a night.
 * Residents on an approved outing covering the date are treated as "on
 * leave" automatically — derived live from hostel_outings, never stored.
 */
@Injectable()
export class NightAttendanceService {
  private readonly logger = new Logger(NightAttendanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async summary(hostelId: number | null, date?: string) {
    const attendanceDate = date ?? todayIso();

    try {
      const roster = await this.prisma.$queryRaw<RosterRow[]>(Prisma.sql`
        SELECT s.id AS student_id,
          sa.first_name, sa.last_name, u.email,
          s.student_id_no AS roll,
          hr.room_number,
          hna.status AS marked_status,
          (hna.id IS NOT NULL AND hna.is_published = false) AS is_draft,
          EXISTS (
            SELECT 1 FROM hostel_outings ho
            WHERE ho.student_id = s.id AND ho.status = 'approved'
              AND ho.from_date <= ${attendanceDate}::date AND ho.to_date >= ${attendanceDate}::date
          ) AS on_leave
        FROM student_hostel_mapping shm
        JOIN students s ON s.id = shm.student_id
        JOIN users u ON u.id = s.user_id
        LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
        JOIN hostel_rooms hr ON hr.id = shm.room_id
        LEFT JOIN hostel_night_attendance hna ON hna.student_id = s.id AND hna.attendance_date = ${attendanceDate}::date
        WHERE ${hostelId != null ? Prisma.sql`hr.hostel_id = ${hostelId}` : Prisma.sql`true`}
        ORDER BY u.email ASC
      `);

      const name = (r: RosterRow) => formatStudentName(r.first_name, r.last_name, r.email);

      const present = roster.filter((r) => r.marked_status === 'present').length;
      const absent = roster.filter((r) => r.marked_status === 'absent').length;
      const onLeave = roster.filter((r) => r.on_leave).length;
      const exceptions = roster.filter((r) => !r.on_leave && r.marked_status == null);

      const draftCount = roster.filter((r) => r.is_draft).length;
      const markedCount = roster.filter((r) => r.marked_status != null).length;

      return {
        date: attendanceDate,
        total_residents: roster.length,
        present,
        absent,
        on_leave: onLeave,
        pending: exceptions.length,
        // Publication state for the day. Nothing marked yet is not "published"
        // — it simply has not been taken, which the UI distinguishes so an
        // untouched evening is never mistaken for a finished one.
        draft_count: draftCount,
        marked_count: markedCount,
        is_published: markedCount > 0 && draftCount === 0,
        exceptions: exceptions.map((r) => ({
          student_id: r.student_id,
          name: name(r),
          roll: r.roll,
          room_number: r.room_number,
        })),
        roster: roster.map((r) => ({
          student_id: r.student_id,
          name: name(r),
          roll: r.roll,
          room_number: r.room_number,
          status: r.on_leave ? 'on_leave' : r.marked_status ?? 'pending',
          is_draft: r.is_draft,
        })),
      };
    } catch (err) {
      this.logger.error('DB error building night attendance summary', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async mark(studentId: number, dto: MarkAttendanceDto, userId: number, hostelId: number | null) {
    const attendanceDate = dto.date ?? todayIso();

    try {
      if (hostelId != null) {
        const owned = await this.prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
          SELECT s.id FROM students s
          JOIN student_hostel_mapping shm ON shm.student_id = s.id
          JOIN hostel_rooms hr ON hr.id = shm.room_id
          WHERE s.id = ${studentId} AND hr.hostel_id = ${hostelId}
        `);
        if (owned.length === 0) {
          throw new BadRequestException({
            message: 'This student is not a resident of your hostel',
            errorCode: 'STUDENT_NOT_IN_HOSTEL',
          });
        }
      }

      // Saved as a draft (published_at stays NULL). Correcting an already
      // published mark returns that one row to draft, so the change has to be
      // published too rather than slipping in silently.
      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO hostel_night_attendance
          (student_id, attendance_date, status, marked_by_user_id, is_published, published_at)
        VALUES (${studentId}, ${attendanceDate}::date, ${dto.status}, ${userId}, false, NULL)
        ON CONFLICT (student_id, attendance_date)
        DO UPDATE SET status = EXCLUDED.status,
                      marked_by_user_id = EXCLUDED.marked_by_user_id,
                      marked_at = now(),
                      is_published = false,
                      published_at = NULL
      `);
      return {
        student_id: studentId,
        date: attendanceDate,
        status: dto.status,
        is_draft: true,
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`DB error marking night attendance for student ${studentId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /hostel/night-attendance/publish — commits the night's sheet.
   *
   * Only the draft rows for that date are promoted, so a re-publish after a
   * late correction touches just the corrected rows and leaves the rest of the
   * evening's record as it was first published.
   */
  async publish(hostelId: number | null, userId: number, date?: string) {
    const attendanceDate = date ?? todayIso();

    try {
      const published = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE hostel_night_attendance hna
        SET is_published = true,
            published_at = now()
        WHERE hna.attendance_date = ${attendanceDate}::date
          AND hna.is_published = false
          AND ${
            hostelId != null
              ? Prisma.sql`EXISTS (
                  SELECT 1
                  FROM student_hostel_mapping shm
                  JOIN hostel_rooms hr ON hr.id = shm.room_id
                  WHERE shm.student_id = hna.student_id
                    AND hr.hostel_id = ${hostelId}
                )`
              : Prisma.sql`true`
          }
      `);

      if (published === 0) {
        throw new BadRequestException({
          message: 'There is nothing to publish for this date',
          errorCode: 'NIGHT_ATTENDANCE_NOTHING_TO_PUBLISH',
        });
      }

      this.logger.log(
        `Night attendance published: ${published} row(s) for ${attendanceDate} by user=${userId}`,
      );
      return { published, date: attendanceDate, is_published: true };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('DB error publishing night attendance', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async resolveAll(hostelId: number | null, userId: number, date?: string) {
    const attendanceDate = date ?? todayIso();

    try {
      // One INSERT ... SELECT rather than a query per student: a full hostel
      // is hundreds of residents, and the previous loop issued that many
      // round trips against a deliberately small connection pool.
      const resolved = await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO hostel_night_attendance
          (student_id, attendance_date, status, marked_by_user_id, is_published, published_at)
        SELECT s.id, ${attendanceDate}::date, 'present', ${userId}, false, NULL
        FROM student_hostel_mapping shm
        JOIN students s ON s.id = shm.student_id
        JOIN hostel_rooms hr ON hr.id = shm.room_id
        LEFT JOIN hostel_night_attendance hna
          ON hna.student_id = s.id AND hna.attendance_date = ${attendanceDate}::date
        WHERE ${hostelId != null ? Prisma.sql`hr.hostel_id = ${hostelId}` : Prisma.sql`true`}
          AND hna.id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM hostel_outings ho
            WHERE ho.student_id = s.id AND ho.status = 'approved'
              AND ho.from_date <= ${attendanceDate}::date AND ho.to_date >= ${attendanceDate}::date
          )
        ON CONFLICT (student_id, attendance_date) DO NOTHING
      `);

      return { resolved, date: attendanceDate, is_draft: true };
    } catch (err) {
      this.logger.error('DB error resolving night attendance', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
