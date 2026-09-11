import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { CreateAppointmentDto } from './dto/appointment.dto';
import {
  assertAppointmentsProvisioned,
  assertSlotBookable,
  deriveSlots,
  isSlotFinished,
  nowRef,
  normaliseHm,
  resolvePatientIdentity,
} from './medical-appointments.util';

/**
 * Medical centre appointments — the booker's side.
 *
 * Serves every authenticated non-parent role (see the @Roles list on
 * medical-appointments.controller.ts). The booker is always taken from the JWT,
 * never from the request, so this service has no way to write a booking in
 * somebody else's name even if a client asked it to.
 *
 * A booking is created as 'pending'. Nothing here touches medical_visits —
 * only medical staff approving it does (see
 * MedicalCentreAppointmentsService.approve).
 */

interface WindowRow {
  id: number;
  slot_date: string;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  capacity_per_slot: number;
  status: 'open' | 'closed';
}

interface SlotCountRow {
  slot_date: string;
  slot_start: string;
  live: number;
}

/** Postgres unique_violation — raised by uq_medical_appointments_active_per_user_slot. */
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class MedicalAppointmentsService {
  private readonly logger = new Logger(MedicalAppointmentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private fail(context: string, err: unknown): never {
    if (err instanceof HttpException) throw err;
    this.logger.error(`DB error ${context}`, err);
    throw new InternalServerErrorException({
      message: 'Something went wrong. Please try again.',
      errorCode: 'INTERNAL_ERROR',
    });
  }

  /**
   * GET /availability?from=&to=
   *
   * One row per date that has at least one open time part. `open_slots` counts
   * only slots that can actually be booked right now — not full, and not
   * finished — so the calendar never advertises a date whose sessions are all
   * over. `total_slots` stays the honest total, which is what lets the app
   * distinguish "nothing scheduled" from "scheduled but done".
   *
   * Past dates are excluded outright: they cannot be booked, so offering them
   * would only produce a dead tap.
   */
  async getAvailability(from: string, to: string) {
    try {
      await assertAppointmentsProvisioned(this.prisma);
      // One clock reading for the whole request, so a slot cannot be counted
      // as open and then rejected as finished a millisecond later.
      const now = nowRef();
      const effectiveFrom = from < now.todayIso ? now.todayIso : from;
      if (effectiveFrom > to) return [];

      const windows = await this.openWindowsBetween(effectiveFrom, to);
      const counts = await this.liveCountsBetween(effectiveFrom, to);

      const byDate = new Map<string, { total: number; open: number }>();
      for (const window of windows) {
        const entry = byDate.get(window.slot_date) ?? { total: 0, open: 0 };
        for (const slot of deriveSlots(
          window.start_time,
          window.end_time,
          window.slot_minutes,
        )) {
          const live =
            counts.get(`${window.slot_date}|${slot.slot_start}`) ?? 0;
          entry.total += 1;
          const finished = isSlotFinished(window.slot_date, slot.slot_end, now);
          if (!finished && live < window.capacity_per_slot) entry.open += 1;
        }
        byDate.set(window.slot_date, entry);
      }

      return [...byDate.entries()]
        .map(([slot_date, entry]) => ({
          slot_date,
          open_slots: entry.open,
          total_slots: entry.total,
        }))
        .sort((a, b) => a.slot_date.localeCompare(b.slot_date));
    } catch (err) {
      this.fail('listing appointment availability', err);
    }
  }

  /**
   * GET /availability/:date — the time parts on one date and their slots.
   *
   * `mine` marks the slots this user already holds a live booking in, and
   * `finished` marks the ones whose end time has passed. Both exist so the app
   * can grey a slot out up front instead of letting the user tap into a
   * rejection — the server enforces the same two rules on POST regardless.
   */
  async getDay(userId: number, date: string) {
    try {
      await assertAppointmentsProvisioned(this.prisma);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new BadRequestException({
          message: 'date must be in YYYY-MM-DD format',
          errorCode: 'VALIDATION_ERROR',
        });
      }

      const now = nowRef();
      const windows = await this.openWindowsBetween(date, date);
      const counts = await this.liveCountsBetween(date, date);
      const mine = await this.myLiveSlotsOn(userId, date);

      return {
        slot_date: date,
        time_parts: windows.map((window) => ({
          window_id: window.id,
          start_time: window.start_time,
          end_time: window.end_time,
          slot_minutes: window.slot_minutes,
          capacity_per_slot: window.capacity_per_slot,
          status: window.status,
          slots: deriveSlots(
            window.start_time,
            window.end_time,
            window.slot_minutes,
          ).map((slot) => {
            const booked = counts.get(`${date}|${slot.slot_start}`) ?? 0;
            const finished = isSlotFinished(date, slot.slot_end, now);
            return {
              slot_start: slot.slot_start,
              slot_end: slot.slot_end,
              capacity: window.capacity_per_slot,
              booked,
              full: booked >= window.capacity_per_slot,
              // Past its end time. A slot that has merely STARTED is not
              // finished and stays bookable.
              finished,
              mine: mine.has(slot.slot_start),
            };
          }),
        })),
      };
    } catch (err) {
      this.fail(`listing appointment slots for ${date}`, err);
    }
  }

  /**
   * POST / — book one slot for the signed-in user.
   *
   * The window row is locked FOR UPDATE first, which serialises every booking
   * against that time part. Without it two callers can both read "9 of 10
   * booked" and both insert, putting the slot over capacity — a count-then-
   * insert is not safe on its own no matter how the count is written.
   */
  async book(userId: number, dto: CreateAppointmentDto) {
    try {
      await assertAppointmentsProvisioned(this.prisma);
      const requestedStart = normaliseHm(dto.slot_start);

      // Resolved before the transaction so the lock is held for as short a time
      // as possible; it is a pure read of the caller's own record.
      const patient = await resolvePatientIdentity(this.prisma, userId);

      const id = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<WindowRow[]>(Prisma.sql`
          SELECT id,
                 to_char(slot_date, 'YYYY-MM-DD') AS slot_date,
                 to_char(start_time, 'HH24:MI')   AS start_time,
                 to_char(end_time, 'HH24:MI')     AS end_time,
                 slot_minutes::int      AS slot_minutes,
                 capacity_per_slot::int AS capacity_per_slot,
                 status
          FROM medical_appointment_windows
          WHERE id = ${dto.window_id}::int
          FOR UPDATE
        `);

        const window = locked[0];
        if (!window) {
          throw new NotFoundException({
            message: 'That appointment session no longer exists.',
            errorCode: 'APPOINTMENT_WINDOW_NOT_FOUND',
          });
        }
        if (window.status !== 'open') {
          throw new ConflictException({
            message: 'The medical centre has closed intake for this session.',
            errorCode: 'WINDOW_CLOSED',
          });
        }

        // The slot must be one this window actually produces — a client cannot
        // invent a time inside or outside the session's hours.
        const slot = deriveSlots(
          window.start_time,
          window.end_time,
          window.slot_minutes,
        ).find((candidate) => candidate.slot_start === requestedStart);
        if (!slot) {
          throw new BadRequestException({
            message: `${requestedStart} is not a slot in this session.`,
            errorCode: 'SLOT_NOT_IN_WINDOW',
          });
        }

        // Bookable right up until the slot ENDS: someone arriving at 10:15
        // for the 10:00-10:30 slot is inside their appointment, not late for it.
        assertSlotBookable(window.slot_date, slot.slot_end);

        const counted = await tx.$queryRaw<
          { live: number; mine: number }[]
        >(Prisma.sql`
          SELECT COUNT(*)::int AS live,
                 COUNT(*) FILTER (WHERE booked_by_user_id = ${userId}::int)::int AS mine
          FROM medical_appointments
          WHERE slot_date = ${window.slot_date}::date
            AND slot_start = ${slot.slot_start}::time
            AND status IN ('pending', 'approved')
        `);
        const { live, mine } = counted[0];

        if (mine > 0) {
          throw new ConflictException({
            message: 'You already have an appointment in this slot.',
            errorCode: 'ALREADY_BOOKED',
          });
        }
        if (live >= window.capacity_per_slot) {
          throw new ConflictException({
            message: `This slot is full — all ${window.capacity_per_slot} places are taken.`,
            errorCode: 'SLOT_FULL',
          });
        }

        const inserted = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
          INSERT INTO medical_appointments
            (window_id, slot_date, slot_start, slot_end, booked_by_user_id,
             patient_kind, student_id, faculty_id, staff_id, reason)
          VALUES
            (${window.id}::int,
             ${window.slot_date}::date,
             ${slot.slot_start}::time,
             ${slot.slot_end}::time,
             ${userId}::int,
             ${patient.kind}::borrower_type_enum,
             ${patient.student_id}::int,
             ${patient.faculty_id}::int,
             ${patient.staff_id}::int,
             ${dto.reason ?? null}::varchar)
          RETURNING id
        `);
        return inserted[0].id;
      });

      this.logger.log(
        `Appointment ${id} booked by user=${userId} for window=${dto.window_id} slot=${requestedStart}`,
      );
      // Fetched by id rather than picked out of listMine(), whose LIMIT 100
      // could in principle not contain the row that was just written.
      return this.getOwnAppointment(userId, id);
    } catch (err) {
      // Backstop for the partial unique index, in case a request slips past the
      // in-transaction check above by some path not considered here.
      if (this.isUniqueViolation(err)) {
        throw new ConflictException({
          message: 'You already have an appointment in this slot.',
          errorCode: 'ALREADY_BOOKED',
        });
      }
      this.fail('booking a medical appointment', err);
    }
  }

  /** GET /mine — the signed-in user's own bookings, newest appointment first. */
  async listMine(userId: number) {
    try {
      await assertAppointmentsProvisioned(this.prisma);
      return await this.prisma.$queryRaw<
        {
          id: number;
          slot_date: string;
          slot_start: string;
          slot_end: string;
          status: string;
          reason: string | null;
          decision_note: string | null;
          created_at: Date;
          visit_id: number | null;
        }[]
      >(Prisma.sql`
        SELECT id,
               to_char(slot_date, 'YYYY-MM-DD') AS slot_date,
               to_char(slot_start, 'HH24:MI')   AS slot_start,
               to_char(slot_end, 'HH24:MI')     AS slot_end,
               status, reason, decision_note, created_at, visit_id
        FROM medical_appointments
        WHERE booked_by_user_id = ${userId}::int
        ORDER BY slot_date DESC, slot_start DESC
        LIMIT 100
      `);
    } catch (err) {
      this.fail('listing own appointments', err);
    }
  }

  /**
   * DELETE /:id — withdraw one's own booking.
   *
   * Scoped to the caller's own rows and to 'pending' only: once staff has
   * approved it there is a queue entry attached, which is theirs to undo.
   */
  async cancel(userId: number, id: number) {
    try {
      await assertAppointmentsProvisioned(this.prisma);

      const rows = await this.prisma.$queryRaw<
        { booked_by_user_id: number; status: string }[]
      >(Prisma.sql`
        SELECT booked_by_user_id, status FROM medical_appointments WHERE id = ${id}::int
      `);
      const booking = rows[0];
      if (!booking) {
        throw new NotFoundException({
          message: 'Appointment not found',
          errorCode: 'APPOINTMENT_NOT_FOUND',
        });
      }
      if (booking.booked_by_user_id !== userId) {
        throw new ForbiddenException({
          message: 'You can only cancel your own appointments.',
          errorCode: 'NOT_OWN_APPOINTMENT',
        });
      }
      if (booking.status !== 'pending') {
        throw new ConflictException({
          message:
            booking.status === 'approved'
              ? 'This appointment is already approved. Contact the medical centre to cancel it.'
              : `This appointment is already ${booking.status}.`,
          errorCode: 'APPOINTMENT_NOT_PENDING',
        });
      }

      await this.prisma.$executeRaw(Prisma.sql`
        UPDATE medical_appointments
        SET status = 'cancelled', updated_at = now()
        WHERE id = ${id}::int AND booked_by_user_id = ${userId}::int AND status = 'pending'
      `);

      this.logger.log(
        `Appointment ${id} cancelled by its booker user=${userId}`,
      );
      return { id, status: 'cancelled' as const };
    } catch (err) {
      this.fail(`cancelling appointment ${id}`, err);
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** One of the caller's own bookings, in the same shape listMine returns. Scoped by booker so it can never read somebody else's row. */
  private async getOwnAppointment(userId: number, id: number) {
    const rows = await this.prisma.$queryRaw<
      {
        id: number;
        slot_date: string;
        slot_start: string;
        slot_end: string;
        status: string;
        reason: string | null;
        decision_note: string | null;
        created_at: Date;
        visit_id: number | null;
      }[]
    >(Prisma.sql`
      SELECT id,
             to_char(slot_date, 'YYYY-MM-DD') AS slot_date,
             to_char(slot_start, 'HH24:MI')   AS slot_start,
             to_char(slot_end, 'HH24:MI')     AS slot_end,
             status, reason, decision_note, created_at, visit_id
      FROM medical_appointments
      WHERE id = ${id}::int AND booked_by_user_id = ${userId}::int
    `);
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({
        message: 'Appointment not found',
        errorCode: 'APPOINTMENT_NOT_FOUND',
      });
    }
    return row;
  }

  /** Open time parts only — a closed session is not offered to bookers at all. */
  private async openWindowsBetween(
    from: string,
    to: string,
  ): Promise<WindowRow[]> {
    return this.prisma.$queryRaw<WindowRow[]>(Prisma.sql`
      SELECT id,
             to_char(slot_date, 'YYYY-MM-DD') AS slot_date,
             to_char(start_time, 'HH24:MI')   AS start_time,
             to_char(end_time, 'HH24:MI')     AS end_time,
             slot_minutes::int      AS slot_minutes,
             capacity_per_slot::int AS capacity_per_slot,
             status
      FROM medical_appointment_windows
      WHERE slot_date BETWEEN ${from}::date AND ${to}::date
        AND status = 'open'
      ORDER BY slot_date, start_time
    `);
  }

  /** Live booking counts keyed "YYYY-MM-DD|HH:mm". */
  private async liveCountsBetween(
    from: string,
    to: string,
  ): Promise<Map<string, number>> {
    const rows = await this.prisma.$queryRaw<SlotCountRow[]>(Prisma.sql`
      SELECT to_char(slot_date, 'YYYY-MM-DD') AS slot_date,
             to_char(slot_start, 'HH24:MI')   AS slot_start,
             COUNT(*)::int                    AS live
      FROM medical_appointments
      WHERE slot_date BETWEEN ${from}::date AND ${to}::date
        AND status IN ('pending', 'approved')
      GROUP BY slot_date, slot_start
    `);
    return new Map(
      rows.map((row) => [`${row.slot_date}|${row.slot_start}`, row.live]),
    );
  }

  /** Slot starts on `date` the user already holds a live booking in. */
  private async myLiveSlotsOn(
    userId: number,
    date: string,
  ): Promise<Set<string>> {
    const rows = await this.prisma.$queryRaw<
      { slot_start: string }[]
    >(Prisma.sql`
      SELECT to_char(slot_start, 'HH24:MI') AS slot_start
      FROM medical_appointments
      WHERE booked_by_user_id = ${userId}::int
        AND slot_date = ${date}::date
        AND status IN ('pending', 'approved')
    `);
    return new Set(rows.map((row) => row.slot_start));
  }

  private isUniqueViolation(err: unknown): boolean {
    const meta = (err as { meta?: { code?: string } })?.meta;
    if (meta?.code === PG_UNIQUE_VIOLATION) return true;
    const message = (err as { message?: string })?.message ?? '';
    return message.includes('uq_medical_appointments_active_per_user_slot');
  }
}
