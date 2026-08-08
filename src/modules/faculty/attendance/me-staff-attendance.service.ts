import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetStaffAttendanceDto } from './dto/get-staff-attendance.dto';

export type StaffAttendanceDayStatus =
  | 'present'
  | 'absent'
  | 'onDuty'
  | 'holiday';

// faculty_daily_attendance.status -> the 4 UI-facing states. full_day/half_day
// both count as attended so both map to "present"; on_leave is folded into
// "absent" (the UI has no separate leave state); weekly_off is folded into
// "holiday" (both are non-working days, same as the fixed palette elsewhere
// in this app only ever showing 4 day-states).
const DAILY_STATUS_TO_UI: Record<string, StaffAttendanceDayStatus> = {
  full_day: 'present',
  half_day: 'present',
  absent: 'absent',
  on_leave: 'absent',
  on_duty: 'onDuty',
  holiday: 'holiday',
  weekly_off: 'holiday',
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function eachDateInRange(from: Date, to: Date): string[] {
  const dates: string[] = [];
  const cursor = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()),
  );
  const end = new Date(
    Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()),
  );
  while (cursor <= end) {
    dates.push(toDateOnly(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

@Injectable()
export class MeStaffAttendanceService {
  private readonly logger = new Logger(MeStaffAttendanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/staff-attendance?year=&month=
   *
   * Self-scoped: faculty_id resolved from the JWT. For each day of the
   * queried month:
   *   1. If a faculty_daily_attendance row exists for that date, its status
   *      is the source of truth (full_day/half_day -> present, absent/
   *      on_leave -> absent, on_duty -> onDuty, holiday/weekly_off ->
   *      holiday - see DAILY_STATUS_TO_UI).
   *   2. Otherwise (no punch/attendance row recorded yet for that day), fall
   *      back to a best-effort derivation from two other real, faculty-owned
   *      sources: faculty_leaves approved by both HoD and HR -> "absent",
   *      and faculty_holiday_mapping -> holiday_slots opted into by this
   *      faculty member -> "holiday".
   * Unlike absent/holiday/onDuty, "present" is NEVER assumed for a day with
   * no data - the present count/marks only include days with a real
   * full_day/half_day faculty_daily_attendance row. A day with nothing in
   * any of the three sources simply has no entry in `marks` at all.
   *
   * Error cases:
   *  404 FACULTY_NOT_FOUND – authenticated user has no linked faculty record
   *  500 INTERNAL_ERROR    – unexpected DB failure
   */
  async getMyStaffAttendance(userId: number, dto: GetStaffAttendanceDto) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty profile not found for this account',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }

    const now = new Date();
    const year = dto.year ?? now.getUTCFullYear();
    const month = dto.month ?? now.getUTCMonth() + 1;

    const monthStart = new Date(Date.UTC(year, month - 1, 1));
    const monthEnd = new Date(Date.UTC(year, month, 0));

    const { dailyRecords, leaves, holidayMappings } = await this.fetchSources(
      userId,
      faculty.id,
      monthStart,
      monthEnd,
    );

    const marks: Record<string, StaffAttendanceDayStatus> = {};

    for (const leave of leaves) {
      const from = leave.from_date < monthStart ? monthStart : leave.from_date;
      const to = leave.to_date > monthEnd ? monthEnd : leave.to_date;
      for (const date of eachDateInRange(from, to)) {
        marks[date] = 'absent';
      }
    }

    for (const mapping of holidayMappings) {
      const slot = mapping.holiday_slots;
      const from = slot.from_date < monthStart ? monthStart : slot.from_date;
      const to = slot.to_date > monthEnd ? monthEnd : slot.to_date;
      for (const date of eachDateInRange(from, to)) {
        marks[date] = 'holiday';
      }
    }

    // faculty_daily_attendance is the authoritative source and overrides the
    // leave/holiday-slot derivation above wherever a real row exists.
    for (const record of dailyRecords) {
      marks[toDateOnly(record.attendance_date)] =
        DAILY_STATUS_TO_UI[record.status] ?? 'present';
    }

    let present = 0;
    let absent = 0;
    let holiday = 0;
    let onDuty = 0;
    for (const status of Object.values(marks)) {
      if (status === 'present') present += 1;
      else if (status === 'absent') absent += 1;
      else if (status === 'holiday') holiday += 1;
      else if (status === 'onDuty') onDuty += 1;
    }
    const workingTotal = present + absent + onDuty;

    return {
      year,
      month,
      stats: {
        present,
        absent,
        onDuty,
        overallPercent:
          workingTotal > 0
            ? round2(((present + onDuty) / workingTotal) * 100)
            : 100,
      },
      marks,
    };
  }

  private async fetchSources(
    userId: number,
    facultyId: number,
    monthStart: Date,
    monthEnd: Date,
  ) {
    try {
      const [dailyRecords, leaves, holidayMappings] = await Promise.all([
        this.prisma.faculty_daily_attendance.findMany({
          where: {
            faculty_id: facultyId,
            attendance_date: { gte: monthStart, lte: monthEnd },
          },
          select: { attendance_date: true, status: true },
        }),
        this.prisma.faculty_leaves.findMany({
          where: {
            faculty_id: facultyId,
            hod_approval_status: 'approved',
            hr_approval_status: 'approved',
            from_date: { lte: monthEnd },
            to_date: { gte: monthStart },
          },
          select: { from_date: true, to_date: true },
        }),
        this.prisma.faculty_holiday_mapping.findMany({
          where: {
            faculty_id: facultyId,
            holiday_slots: {
              from_date: { lte: monthEnd },
              to_date: { gte: monthStart },
            },
          },
          select: {
            holiday_slots: { select: { from_date: true, to_date: true } },
          },
        }),
      ]);
      return { dailyRecords, leaves, holidayMappings };
    } catch (err) {
      this.logger.error(
        `Failed to fetch staff attendance sources for user ${userId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
