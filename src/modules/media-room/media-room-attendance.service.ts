import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MarkAttendanceDto } from './dto/mark-attendance.dto';

interface AttendanceRow {
  attendance_date: Date;
  status: string;
  punch_in: Date | null;
  punch_out: Date | null;
}

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function toTimeString(d: Date | null): string | null {
  if (!d) return null;
  return d.toISOString().slice(11, 16);
}

/** "8h 09m" between two real punches — null whenever either side is missing (self-logged rows have no punches at all). */
function toDuration(punchIn: Date | null, punchOut: Date | null): string | null {
  if (!punchIn || !punchOut) return null;
  const minutes = Math.round((punchOut.getTime() - punchIn.getTime()) / 60_000);
  if (minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${String(remainder).padStart(2, '0')}m`;
}

/** Same academic-year convention as hr-requests.service.ts's academicYearFor — July–June, e.g. "2026-27". */
function academicYearFor(date: Date): string {
  const calendarYear = date.getUTCFullYear();
  const academicStartYear = date.getUTCMonth() + 1 >= 6 ? calendarYear : calendarYear - 1;
  return `${academicStartYear}-${String((academicStartYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * Staff attendance — the real, pre-existing `faculty_daily_attendance` table
 * (in schema.prisma). Its `staff_user_id` column (added alongside the
 * original faculty_id, now nullable) is the generic non-teaching-staff
 * column this needs — no new table. Self-logged: media_room has no
 * biometric device behind it, so punch_in/punch_out stay null on rows it
 * creates (they're genuinely populated for real faculty by other means).
 */
@Injectable()
export class MediaRoomAttendanceService {
  private readonly logger = new Logger(MediaRoomAttendanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findMine(userId: number) {
    let rows: AttendanceRow[];
    try {
      rows = await this.prisma.faculty_daily_attendance.findMany({
        where: { staff_user_id: userId },
        orderBy: { attendance_date: 'asc' },
        select: { attendance_date: true, status: true, punch_in: true, punch_out: true },
      });
    } catch (err) {
      this.logger.error('DB error listing staff attendance', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }

    const byMonth = new Map<string, AttendanceRow[]>();
    for (const r of rows) {
      const key = toIsoDate(r.attendance_date).slice(0, 7);
      const list = byMonth.get(key) ?? [];
      list.push(r);
      byMonth.set(key, list);
    }

    const summarize = (list: AttendanceRow[]) => {
      const full_days = list.filter((r) => r.status === 'full_day').length;
      const half_days = list.filter((r) => r.status === 'half_day').length;
      const absent = list.filter((r) => r.status === 'absent').length;
      const on_leave = list.filter((r) => r.status === 'on_leave').length;
      const on_duty = list.filter((r) => r.status === 'on_duty').length;
      const total = list.length;
      const attendance_percentage = total > 0 ? Math.round(((full_days + half_days * 0.5 + on_duty) / total) * 100) : 0;
      return { full_days, half_days, absent, on_leave, on_duty, on_vacation: 0, attendance_percentage };
    };

    const months = [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, list]) => {
        const [y, m] = month.split('-').map(Number);
        return {
          month,
          label: `${MONTH_LABELS[m - 1]} ${y}`,
          days: list.map((r) => ({
            date: toIsoDate(r.attendance_date),
            day: toIsoDate(r.attendance_date),
            punch_in: toTimeString(r.punch_in),
            punch_out: toTimeString(r.punch_out),
            status: r.status,
            duration: toDuration(r.punch_in, r.punch_out),
            note: null,
          })),
          ...summarize(list),
        };
      });

    const overall = summarize(rows);
    const recent_punches = rows
      .slice(-10)
      .reverse()
      .map((r) => ({
        date: toIsoDate(r.attendance_date),
        day: toIsoDate(r.attendance_date),
        punch_in: toTimeString(r.punch_in),
        punch_out: toTimeString(r.punch_out),
        status: r.status,
        duration: toDuration(r.punch_in, r.punch_out),
        note: null,
      }));

    return { ready: true, overall, months, recent_punches };
  }

  async mark(dto: MarkAttendanceDto, userId: number) {
    const date = new Date(dto.date ?? new Date().toISOString().slice(0, 10));

    try {
      const existing = await this.prisma.faculty_daily_attendance.findFirst({
        where: { staff_user_id: userId, attendance_date: date },
      });

      if (existing) {
        const updated = await this.prisma.faculty_daily_attendance.update({
          where: { id: existing.id },
          data: { status: dto.status },
        });
        return { date: toIsoDate(updated.attendance_date), status: updated.status };
      }

      const created = await this.prisma.faculty_daily_attendance.create({
        data: { staff_user_id: userId, attendance_date: date, status: dto.status, academic_year: academicYearFor(date) },
      });
      return { date: toIsoDate(created.attendance_date), status: created.status };
    } catch (err) {
      this.logger.error('DB error marking staff attendance', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
