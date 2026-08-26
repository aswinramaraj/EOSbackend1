import {
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { Prisma } from '../../../generated/prisma/client';
import { requireUpdateSet } from './medical-sql.util';
import type {
  CreateAppointmentWindowDto,
  UpdateAppointmentWindowDto,
} from './dto/appointment.dto';
import {
  DEFAULT_CAPACITY_PER_SLOT,
  DEFAULT_SLOT_MINUTES,
  assertAppointmentsProvisioned,
  assertValidWindowShape,
  assertWindowDateNotPast,
  deriveSlots,
  hmToMinutes,
  lockAppointmentDate,
  normaliseHm,
  rangesOverlap,
  type PatientKind,
} from './medical-appointments.util';

/**
 * Medical centre appointments — the staff side.
 *
 * A **time part** (medical_appointment_windows) is what staff opens on a date.
 * A **slot** is one fixed-length division of it, derived on read and never
 * stored, so editing a time part cannot leave stale slot rows behind.
 *
 * Bookings sit at status 'pending' and are NOT in the OPD queue. `approve()` is
 * the only code path in this module that writes to medical_visits, which is
 * what makes "nothing reaches the queue without approval" a property of the
 * system rather than a convention.
 */

interface WindowRow {
  id: number;
  slot_date: string;
  start_time: string;
  end_time: string;
  slot_minutes: number;
  capacity_per_slot: number;
  status: 'open' | 'closed';
  booked_count: number;
  pending_count: number;
}

interface SlotCountRow {
  slot_start: string;
  pending: number;
  approved: number;
}

interface BookingRow {
  id: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  patient_kind: PatientKind;
  reason: string | null;
  booked_at: Date;
  decided_at: Date | null;
  decision_note: string | null;
  visit_id: number | null;
  student_name: string | null;
  roll_no: string | null;
  register_no: string | null;
  student_dept: string | null;
  faculty_name: string | null;
  staff_code: string | null;
  faculty_dept: string | null;
  staff_name: string | null;
  staff_dept: string | null;
  booker_email: string;
}

@Injectable()
export class MedicalCentreAppointmentsService {
  private readonly logger = new Logger(MedicalCentreAppointmentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Anything not already an HttpException is a real DB fault: log the detail
   * server-side and return the module's standard opaque message, never the
   * driver's text.
   */
  private fail(context: string, err: unknown): never {
    if (err instanceof HttpException) throw err;
    this.logger.error(`DB error ${context}`, err);
    throw new InternalServerErrorException({
      message: 'Something went wrong. Please try again.',
      errorCode: 'INTERNAL_ERROR',
    });
  }

  /** GET /windows?from=&to= — every time part in a range, with its live booking counts. */
  async listWindows(from: string, to: string) {
    try {
      await assertAppointmentsProvisioned(this.prisma);
      const rows = await this.prisma.$queryRaw<WindowRow[]>(Prisma.sql`
        SELECT w.id,
               to_char(w.slot_date, 'YYYY-MM-DD') AS slot_date,
               to_char(w.start_time, 'HH24:MI')   AS start_time,
               to_char(w.end_time, 'HH24:MI')     AS end_time,
               w.slot_minutes::int      AS slot_minutes,
               w.capacity_per_slot::int AS capacity_per_slot,
               w.status,
               COALESCE(a.live, 0)::int    AS booked_count,
               COALESCE(a.pending, 0)::int AS pending_count
        FROM medical_appointment_windows w
        LEFT JOIN (
          SELECT window_id,
                 COUNT(*) FILTER (WHERE status IN ('pending', 'approved')) AS live,
                 COUNT(*) FILTER (WHERE status = 'pending')                AS pending
          FROM medical_appointments
          GROUP BY window_id
        ) a ON a.window_id = w.id
        WHERE w.slot_date BETWEEN ${from}::date AND ${to}::date
        ORDER BY w.slot_date, w.start_time
      `);

      return rows.map((row) => ({
        ...row,
        slot_count: deriveSlots(row.start_time, row.end_time, row.slot_minutes)
          .length,
      }));
    } catch (err) {
      this.fail('listing appointment windows', err);
    }
  }

  /** POST /windows — add one time part, refusing anything that overlaps a time part already on that date. */
  async createWindow(dto: CreateAppointmentWindowDto, userId: number) {
    try {
      await assertAppointmentsProvisioned(this.prisma);

      const startTime = normaliseHm(dto.start_time);
      const endTime = normaliseHm(dto.end_time);
      const slotMinutes = dto.slot_minutes ?? DEFAULT_SLOT_MINUTES;
      const capacity = dto.capacity_per_slot ?? DEFAULT_CAPACITY_PER_SLOT;

      // A day that is already over cannot have sessions opened on it. The
      // boundary is midnight: at 23:59 today is still today, one minute later
      // it is not. Enforced here and not only in the UI, because a disabled
      // button is a convenience and this is the actual rule.
      assertWindowDateNotPast(dto.slot_date);

      assertValidWindowShape({
        start_time: startTime,
        end_time: endTime,
        slot_minutes: slotMinutes,
        capacity_per_slot: capacity,
      });

      const id = await this.prisma.$transaction(async (tx) => {
        // Serialises concurrent adds on the same date, so two overlapping time
        // parts cannot both pass the check below.
        await lockAppointmentDate(tx, dto.slot_date);
        await this.assertNoOverlap(tx, dto.slot_date, startTime, endTime, null);

        const inserted = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
          INSERT INTO medical_appointment_windows
            (slot_date, start_time, end_time, slot_minutes, capacity_per_slot, created_by_user_id)
          VALUES
            (${dto.slot_date}::date, ${startTime}::time, ${endTime}::time,
             ${slotMinutes}::smallint, ${capacity}::smallint, ${userId}::int)
          RETURNING id
        `);
        return inserted[0].id;
      });

      this.logger.log(
        `Appointment window ${id} opened on ${dto.slot_date} ${startTime}-${endTime} by user=${userId}`,
      );
      return this.getWindow(id);
    } catch (err) {
      this.fail('creating an appointment window', err);
    }
  }

  /**
   * PATCH /windows/:id
   *
   * Moving the hours or changing the slot length of a time part that already
   * has live bookings is refused rather than silently relocating somebody's
   * appointment. Closing intake and raising capacity stay available, since
   * neither invalidates a booking that already exists.
   */
  async updateWindow(id: number, dto: UpdateAppointmentWindowDto) {
    try {
      await assertAppointmentsProvisioned(this.prisma);
      const current = await this.getWindowRow(id);

      const startTime = dto.start_time
        ? normaliseHm(dto.start_time)
        : current.start_time;
      const endTime = dto.end_time
        ? normaliseHm(dto.end_time)
        : current.end_time;
      const slotMinutes = dto.slot_minutes ?? current.slot_minutes;
      const capacity = dto.capacity_per_slot ?? current.capacity_per_slot;

      const reshaped =
        startTime !== current.start_time ||
        endTime !== current.end_time ||
        slotMinutes !== current.slot_minutes;

      if (reshaped && current.booked_count > 0) {
        throw new ConflictException({
          message: `This time part already has ${current.booked_count} booking(s). Close intake or handle those bookings before changing its hours.`,
          errorCode: 'WINDOW_HAS_BOOKINGS',
        });
      }

      // Reshaping a session on a day that has already passed is refused for the
      // same reason creating one is. Toggling status (close intake) and
      // adjusting capacity stay allowed on a past date, since those are
      // administrative tidy-up on a session that already happened rather than
      // an attempt to schedule into the past.
      if (reshaped) {
        assertWindowDateNotPast(current.slot_date);
      }

      assertValidWindowShape({
        start_time: startTime,
        end_time: endTime,
        slot_minutes: slotMinutes,
        capacity_per_slot: capacity,
      });

      if (dto.capacity_per_slot !== undefined) {
        await this.assertCapacityNotBelowBooked(id, capacity);
      }

      await this.prisma.$transaction(async (tx) => {
        await lockAppointmentDate(tx, current.slot_date);
        if (reshaped) {
          await this.assertNoOverlap(
            tx,
            current.slot_date,
            startTime,
            endTime,
            id,
          );
        }

        // PATCH is partial: an omitted field keeps its stored value rather than
        // being blanked. See requireUpdateSet.
        const assignments = requireUpdateSet([
          {
            column: 'start_time',
            value: dto.start_time ? startTime : undefined,
          },
          { column: 'end_time', value: dto.end_time ? endTime : undefined },
          { column: 'slot_minutes', value: dto.slot_minutes },
          { column: 'capacity_per_slot', value: dto.capacity_per_slot },
          { column: 'status', value: dto.status },
        ]);

        await tx.$executeRaw(Prisma.sql`
          UPDATE medical_appointment_windows
          SET ${assignments}, updated_at = now()
          WHERE id = ${id}::int
        `);
      });

      return this.getWindow(id);
    } catch (err) {
      this.fail(`updating appointment window ${id}`, err);
    }
  }

  /** DELETE /windows/:id — refused while the time part still holds live bookings. */
  async deleteWindow(id: number) {
    try {
      await assertAppointmentsProvisioned(this.prisma);
      const current = await this.getWindowRow(id);

      if (current.booked_count > 0) {
        throw new ConflictException({
          message: `This time part has ${current.booked_count} booking(s) on it. Reject or cancel those first.`,
          errorCode: 'WINDOW_HAS_BOOKINGS',
        });
      }

      // Rejected/cancelled rows still reference the window (ON DELETE RESTRICT),
      // so they go first — they carry no live commitment to anyone.
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw(
          Prisma.sql`DELETE FROM medical_appointments WHERE window_id = ${id}::int`,
        );
        await tx.$executeRaw(
          Prisma.sql`DELETE FROM medical_appointment_windows WHERE id = ${id}::int`,
        );
      });

      this.logger.log(`Appointment window ${id} removed`);
      return { id };
    } catch (err) {
      this.fail(`deleting appointment window ${id}`, err);
    }
  }

  /**
   * GET /slots?date= — the whole day, grouped time part by time part, each with
   * its derived slots and their live counts.
   *
   * Two queries rather than one per slot: the windows for the date, and one
   * grouped count over that date's bookings.
   */
  async getDay(date: string) {
    try {
      await assertAppointmentsProvisioned(this.prisma);
      const windows = await this.listWindows(date, date);
      const counts = await this.slotCounts(date);

      return {
        slot_date: date,
        windows: windows.map((window) => ({
          window,
          slots: deriveSlots(
            window.start_time,
            window.end_time,
            window.slot_minutes,
          ).map((slot) => {
            const count = counts.get(slot.slot_start);
            const pending = count?.pending ?? 0;
            const approved = count?.approved ?? 0;
            const booked = pending + approved;
            return {
              slot_start: slot.slot_start,
              slot_end: slot.slot_end,
              capacity: window.capacity_per_slot,
              booked,
              pending,
              approved,
              full: booked >= window.capacity_per_slot,
            };
          }),
        })),
      };
    } catch (err) {
      this.fail(`listing appointment slots for ${date}`, err);
    }
  }

  /** GET /bookings?date=&start= — who booked one derived slot, newest decision state included. */
  async listSlotBookings(date: string, start: string) {
    try {
      await assertAppointmentsProvisioned(this.prisma);
      const slotStart = normaliseHm(start);

      const rows = await this.prisma.$queryRaw<BookingRow[]>(Prisma.sql`
        SELECT ma.id,
               ma.status,
               ma.patient_kind::text AS patient_kind,
               ma.reason,
               ma.created_at   AS booked_at,
               ma.decided_at,
               ma.decision_note,
               ma.visit_id,
               COALESCE(
                 NULLIF(TRIM(CONCAT(sa.first_name, ' ', COALESCE(sa.last_name, ''))), ''),
                 su.email
               )                                                                   AS student_name,
               s.roll_no,
               s.register_no,
               sd.code                                                             AS student_dept,
               NULLIF(TRIM(CONCAT(f.first_name, ' ', COALESCE(f.last_name, ''))), '')   AS faculty_name,
               f.staff_code,
               fd.code                                                             AS faculty_dept,
               NULLIF(TRIM(CONCAT(nts.first_name, ' ', COALESCE(nts.last_name, ''))), '') AS staff_name,
               nd.code                                                             AS staff_dept,
               bu.email                                                            AS booker_email
        FROM medical_appointments ma
        JOIN users bu                 ON bu.id = ma.booked_by_user_id
        LEFT JOIN students s          ON s.id = ma.student_id
        LEFT JOIN users su            ON su.id = s.user_id
        LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
        LEFT JOIN classes c           ON c.id = s.class_id
        LEFT JOIN departments sd      ON sd.id = c.department_id
        LEFT JOIN faculty f           ON f.id = ma.faculty_id
        LEFT JOIN departments fd      ON fd.id = f.department_id
        LEFT JOIN non_teaching_staff nts ON nts.id = ma.staff_id
        LEFT JOIN departments nd      ON nd.id = nts.department_id
        WHERE ma.slot_date = ${date}::date
          AND ma.slot_start = ${slotStart}::time
        ORDER BY
          CASE ma.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
          ma.created_at
      `);

      return rows.map((row) => {
        const name =
          row.patient_kind === 'student'
            ? row.student_name
            : row.patient_kind === 'faculty'
              ? row.faculty_name
              : row.staff_name;
        const identifier =
          row.patient_kind === 'student'
            ? (row.roll_no ?? row.register_no)
            : row.patient_kind === 'faculty'
              ? row.staff_code
              : null;
        const department =
          row.patient_kind === 'student'
            ? row.student_dept
            : row.patient_kind === 'faculty'
              ? row.faculty_dept
              : row.staff_dept;

        return {
          id: row.id,
          status: row.status,
          patient_kind: row.patient_kind,
          // Falls back to the booking account's email rather than showing
          // "Unknown" — the person is always identifiable at the counter.
          name: name ?? row.booker_email,
          identifier,
          department,
          reason: row.reason,
          booked_at: row.booked_at,
          decided_at: row.decided_at,
          decision_note: row.decision_note,
          visit_id: row.visit_id,
        };
      });
    } catch (err) {
      this.fail(`listing bookings for ${date} ${start}`, err);
    }
  }

  /**
   * POST /bookings/:id/approve — the only path from a booking into the OPD queue.
   *
   * Creates the medical_visits row and links it back in one transaction, so a
   * booking can never end up marked approved without a queue entry, or produce
   * two queue entries if the button is pressed twice.
   */
  async approve(id: number, deciderUserId: number, note?: string) {
    try {
      await assertAppointmentsProvisioned(this.prisma);

      const result = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          {
            id: number;
            status: string;
            patient_kind: PatientKind;
            student_id: number | null;
            faculty_id: number | null;
            staff_id: number | null;
            reason: string | null;
            slot_date: string;
            slot_start: string;
            slot_end: string;
            booked_by_user_id: number;
          }[]
        >(Prisma.sql`
          SELECT id, status, patient_kind::text AS patient_kind,
                 student_id, faculty_id, staff_id, reason,
                 to_char(slot_date, 'YYYY-MM-DD') AS slot_date,
                 to_char(slot_start, 'HH24:MI')   AS slot_start,
                 to_char(slot_end, 'HH24:MI')     AS slot_end,
                 booked_by_user_id
          FROM medical_appointments
          WHERE id = ${id}::int
          FOR UPDATE
        `);

        const booking = locked[0];
        if (!booking) {
          throw new NotFoundException({
            message: 'Appointment not found',
            errorCode: 'APPOINTMENT_NOT_FOUND',
          });
        }
        if (booking.status !== 'pending') {
          throw new ConflictException({
            message: `This appointment is already ${booking.status}.`,
            errorCode: 'APPOINTMENT_NOT_PENDING',
          });
        }

        // visit_date is the appointment's own date, not today, so a booking for
        // next week lands on next week's OPD queue. queued_at is the slot's
        // start instant, which makes the queue's live "waiting" figure measure
        // lateness against the appointment rather than against approval time.
        const visit = await tx.$queryRaw<{ id: number }[]>(Prisma.sql`
          INSERT INTO medical_visits
            (visitor_type, student_id, faculty_id, staff_id, visit_date, reason, status, queued_at)
          VALUES
            (${booking.patient_kind}::borrower_type_enum,
             ${booking.student_id}::int,
             ${booking.faculty_id}::int,
             ${booking.staff_id}::int,
             ${booking.slot_date}::date,
             ${booking.reason}::varchar,
             'waiting',
             (${booking.slot_date}::date + ${booking.slot_start}::time)::timestamptz)
          RETURNING id
        `);
        const visitId = visit[0].id;

        await tx.$executeRaw(Prisma.sql`
          UPDATE medical_appointments
          SET status = 'approved',
              decided_by_user_id = ${deciderUserId}::int,
              decided_at = now(),
              decision_note = ${note ?? null}::varchar,
              visit_id = ${visitId}::int,
              updated_at = now()
          WHERE id = ${id}::int
        `);

        return { visitId, booking };
      });

      await this.notifyDecision(
        result.booking,
        'approved',
        note,
        result.visitId,
      );
      this.logger.log(
        `Appointment ${id} approved by user=${deciderUserId}, queued as visit ${result.visitId}`,
      );
      return { id, status: 'approved' as const, visit_id: result.visitId };
    } catch (err) {
      this.fail(`approving appointment ${id}`, err);
    }
  }

  /** POST /bookings/:id/reject — declines the booking; nothing is written to the OPD queue. */
  async reject(id: number, deciderUserId: number, note?: string) {
    try {
      await assertAppointmentsProvisioned(this.prisma);

      const booking = await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<
          {
            status: string;
            slot_date: string;
            slot_start: string;
            slot_end: string;
            booked_by_user_id: number;
          }[]
        >(Prisma.sql`
          SELECT status,
                 to_char(slot_date, 'YYYY-MM-DD') AS slot_date,
                 to_char(slot_start, 'HH24:MI')   AS slot_start,
                 to_char(slot_end, 'HH24:MI')     AS slot_end,
                 booked_by_user_id
          FROM medical_appointments
          WHERE id = ${id}::int
          FOR UPDATE
        `);

        const row = locked[0];
        if (!row) {
          throw new NotFoundException({
            message: 'Appointment not found',
            errorCode: 'APPOINTMENT_NOT_FOUND',
          });
        }
        if (row.status !== 'pending') {
          throw new ConflictException({
            message: `This appointment is already ${row.status}.`,
            errorCode: 'APPOINTMENT_NOT_PENDING',
          });
        }

        await tx.$executeRaw(Prisma.sql`
          UPDATE medical_appointments
          SET status = 'rejected',
              decided_by_user_id = ${deciderUserId}::int,
              decided_at = now(),
              decision_note = ${note ?? null}::varchar,
              updated_at = now()
          WHERE id = ${id}::int
        `);

        return row;
      });

      await this.notifyDecision(booking, 'rejected', note, null);
      this.logger.log(`Appointment ${id} rejected by user=${deciderUserId}`);
      return { id, status: 'rejected' as const };
    } catch (err) {
      this.fail(`rejecting appointment ${id}`, err);
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async getWindow(id: number) {
    const row = await this.getWindowRow(id);
    return {
      ...row,
      slot_count: deriveSlots(row.start_time, row.end_time, row.slot_minutes)
        .length,
    };
  }

  private async getWindowRow(id: number): Promise<WindowRow> {
    const rows = await this.prisma.$queryRaw<WindowRow[]>(Prisma.sql`
      SELECT w.id,
             to_char(w.slot_date, 'YYYY-MM-DD') AS slot_date,
             to_char(w.start_time, 'HH24:MI')   AS start_time,
             to_char(w.end_time, 'HH24:MI')     AS end_time,
             w.slot_minutes::int      AS slot_minutes,
             w.capacity_per_slot::int AS capacity_per_slot,
             w.status,
             COALESCE(a.live, 0)::int    AS booked_count,
             COALESCE(a.pending, 0)::int AS pending_count
      FROM medical_appointment_windows w
      LEFT JOIN (
        SELECT window_id,
               COUNT(*) FILTER (WHERE status IN ('pending', 'approved')) AS live,
               COUNT(*) FILTER (WHERE status = 'pending')                AS pending
        FROM medical_appointments
        WHERE window_id = ${id}::int
        GROUP BY window_id
      ) a ON a.window_id = w.id
      WHERE w.id = ${id}::int
    `);
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({
        message: 'Time part not found',
        errorCode: 'APPOINTMENT_WINDOW_NOT_FOUND',
      });
    }
    return row;
  }

  /** Live (pending + approved) counts per slot start, for one date. */
  private async slotCounts(date: string): Promise<Map<string, SlotCountRow>> {
    const rows = await this.prisma.$queryRaw<SlotCountRow[]>(Prisma.sql`
      SELECT to_char(slot_start, 'HH24:MI') AS slot_start,
             COUNT(*) FILTER (WHERE status = 'pending')::int  AS pending,
             COUNT(*) FILTER (WHERE status = 'approved')::int AS approved
      FROM medical_appointments
      WHERE slot_date = ${date}::date
        AND status IN ('pending', 'approved')
      GROUP BY slot_start
    `);
    return new Map(rows.map((row) => [row.slot_start, row]));
  }

  /**
   * Refuses a time part that overlaps one already on the same date. Must be
   * called inside the transaction that holds the date's advisory lock,
   * otherwise two concurrent callers can both read "no overlap" and both write.
   */
  private async assertNoOverlap(
    tx: Prisma.TransactionClient,
    slotDate: string,
    startTime: string,
    endTime: string,
    excludeWindowId: number | null,
  ): Promise<void> {
    const existing = await tx.$queryRaw<
      { id: number; s: string; e: string }[]
    >(Prisma.sql`
      SELECT id,
             to_char(start_time, 'HH24:MI') AS s,
             to_char(end_time, 'HH24:MI')   AS e
      FROM medical_appointment_windows
      WHERE slot_date = ${slotDate}::date
        AND (${excludeWindowId}::int IS NULL OR id <> ${excludeWindowId}::int)
    `);

    const from = hmToMinutes(startTime);
    const to = hmToMinutes(endTime);
    for (const row of existing) {
      if (rangesOverlap(from, to, hmToMinutes(row.s), hmToMinutes(row.e))) {
        throw new ConflictException({
          message: `This overlaps the ${row.s}–${row.e} time part already on ${slotDate}.`,
          errorCode: 'WINDOW_OVERLAP',
        });
      }
    }
  }

  /** Capacity may not drop below what a slot in this window has already taken. */
  private async assertCapacityNotBelowBooked(
    windowId: number,
    capacity: number,
  ): Promise<void> {
    const rows = await this.prisma.$queryRaw<
      { max_booked: number }[]
    >(Prisma.sql`
      SELECT COALESCE(MAX(live), 0)::int AS max_booked
      FROM (
        SELECT COUNT(*)::int AS live
        FROM medical_appointments
        WHERE window_id = ${windowId}::int
          AND status IN ('pending', 'approved')
        GROUP BY slot_start
      ) per_slot
    `);
    const maxBooked = rows[0]?.max_booked ?? 0;
    if (capacity < maxBooked) {
      throw new ConflictException({
        message: `One slot in this time part already has ${maxBooked} booking(s), so capacity cannot be set below that.`,
        errorCode: 'CAPACITY_BELOW_BOOKED',
      });
    }
  }

  /**
   * Tells the person who booked what happened. Deliberately after the
   * transaction commits and never allowed to fail the request — a delivered
   * decision with an undelivered notification is recoverable, a rolled-back
   * decision because the push gateway was down is not.
   */
  private async notifyDecision(
    booking: {
      slot_date: string;
      slot_start: string;
      slot_end: string;
      booked_by_user_id: number;
    },
    decision: 'approved' | 'rejected',
    note: string | undefined,
    visitId: number | null,
  ): Promise<void> {
    const when = `${booking.slot_date} ${booking.slot_start}–${booking.slot_end}`;
    const tail =
      decision === 'approved'
        ? ` You are in the OPD queue${visitId ? ` (token T-${visitId})` : ''}.`
        : '';
    try {
      await this.notifications.notify({
        user_id: booking.booked_by_user_id,
        title:
          decision === 'approved'
            ? 'Medical appointment approved'
            : 'Medical appointment rejected',
        message: `Your medical appointment for ${when} was ${decision}.${tail}${note ? ` Note: ${note}` : ''}`,
        type:
          decision === 'approved'
            ? 'approval_request_approved'
            : 'approval_request_rejected',
        related_entity_type: 'medical_appointment',
      });
    } catch (err) {
      this.logger.warn(
        `Appointment decision saved but notifying user=${booking.booked_by_user_id} failed`,
        err as Error,
      );
    }
  }
}
