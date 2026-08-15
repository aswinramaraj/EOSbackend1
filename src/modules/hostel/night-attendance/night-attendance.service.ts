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
  on_leave: boolean;
}

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

      return {
        date: attendanceDate,
        total_residents: roster.length,
        present,
        absent,
        on_leave: onLeave,
        pending: exceptions.length,
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

      await this.prisma.$executeRaw(Prisma.sql`
        INSERT INTO hostel_night_attendance (student_id, attendance_date, status, marked_by_user_id)
        VALUES (${studentId}, ${attendanceDate}::date, ${dto.status}, ${userId})
        ON CONFLICT (student_id, attendance_date)
        DO UPDATE SET status = EXCLUDED.status, marked_by_user_id = EXCLUDED.marked_by_user_id, marked_at = now()
      `);
      return { student_id: studentId, date: attendanceDate, status: dto.status };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`DB error marking night attendance for student ${studentId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async resolveAll(hostelId: number | null, userId: number, date?: string) {
    const attendanceDate = date ?? todayIso();

    try {
      const rows = await this.prisma.$queryRaw<{ student_id: number }[]>(Prisma.sql`
        SELECT s.id AS student_id
        FROM student_hostel_mapping shm
        JOIN students s ON s.id = shm.student_id
        JOIN hostel_rooms hr ON hr.id = shm.room_id
        LEFT JOIN hostel_night_attendance hna ON hna.student_id = s.id AND hna.attendance_date = ${attendanceDate}::date
        WHERE ${hostelId != null ? Prisma.sql`hr.hostel_id = ${hostelId}` : Prisma.sql`true`}
          AND hna.id IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM hostel_outings ho
            WHERE ho.student_id = s.id AND ho.status = 'approved'
              AND ho.from_date <= ${attendanceDate}::date AND ho.to_date >= ${attendanceDate}::date
          )
      `);

      for (const row of rows) {
        await this.prisma.$executeRaw(Prisma.sql`
          INSERT INTO hostel_night_attendance (student_id, attendance_date, status, marked_by_user_id)
          VALUES (${row.student_id}, ${attendanceDate}::date, 'present', ${userId})
          ON CONFLICT (student_id, attendance_date) DO NOTHING
        `);
      }

      return { resolved: rows.length, date: attendanceDate };
    } catch (err) {
      this.logger.error('DB error resolving night attendance', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
