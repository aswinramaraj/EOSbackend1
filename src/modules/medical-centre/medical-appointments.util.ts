import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { ALLOWED_SLOT_MINUTES } from './dto/appointment.dto';

/**
 * Shared slot arithmetic, schema detection and patient-identity resolution for
 * the appointment booking workflow.
 *
 * Every time value crossing this boundary is an "HH:mm" string. Postgres `time`
 * columns are always selected with to_char(...) rather than read raw, because
 * the driver's mapping of `time` is not a plain string and differs from `date`
 * — normalising in SQL keeps every layer above it dealing with one shape.
 */

export const DEFAULT_SLOT_MINUTES = 30;
export const DEFAULT_CAPACITY_PER_SLOT = 10;

/** Advisory-lock namespace for this feature, so a lock here cannot collide with another module's. */
const APPOINTMENT_LOCK_NAMESPACE = 911_001;

/** "10:00:00" | "10:00" -> "10:00". */
export function normaliseHm(time: string): string {
  return time.trim().slice(0, 5);
}

/** "13:30" -> 810. Throws rather than returning null: callers have already passed DTO validation, so a failure here is a bug, not user input. */
export function hmToMinutes(time: string): number {
  const [hours, minutes] = normaliseHm(time).split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
    throw new BadRequestException({
      message: `Invalid time value: ${time}`,
      errorCode: 'VALIDATION_ERROR',
    });
  }
  return hours * 60 + minutes;
}

/** 810 -> "13:30". */
export function minutesToHm(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

// ── Time boundaries ─────────────────────────────────────────────────────────
//
// One definition of "past", used by the booking side, the staff side and (via
// the API payloads) both frontends. Duplicating this logic per caller is how a
// system ends up letting a patient book a slot the staff page thinks is over.
//
// Everything is local wall-clock, deliberately: staff opening a session and a
// patient booking it are both reading their own clocks, and the DB stores
// slot_date/slot_start as date+time with no zone. Never toIsoString(), which
// converts to UTC first and shifts the calendar day in IST.

export interface NowRef {
  /** Local calendar day, YYYY-MM-DD. */
  todayIso: string;
  /** Minutes since local midnight. */
  nowMinutes: number;
}

/** Injectable clock, so the boundary rules can be unit-tested at any instant. */
export function nowRef(at: Date = new Date()): NowRef {
  const todayIso = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
  return { todayIso, nowMinutes: at.getHours() * 60 + at.getMinutes() };
}

/**
 * A calendar day strictly before today.
 *
 * The boundary is midnight, not "some hours ago": at 23:59 on 25 Aug the 25th
 * is still not past, and one minute later it is. That is exactly the rule staff
 * asked for when opening time parts.
 */
export function isDatePast(slotDate: string, now: NowRef = nowRef()): boolean {
  return slotDate < now.todayIso;
}

/**
 * True once the slot's END has been reached.
 *
 * A slot that has STARTED but not ended is NOT finished — it is still bookable.
 * Someone who walks in at 10:15 for the 10:00–10:30 slot is inside their
 * appointment, so refusing them would be wrong.
 */
export function isSlotFinished(
  slotDate: string,
  slotEnd: string,
  now: NowRef = nowRef(),
): boolean {
  if (slotDate < now.todayIso) return true;
  if (slotDate > now.todayIso) return false;
  return hmToMinutes(slotEnd) <= now.nowMinutes;
}

/**
 * Staff may not open a time part on a day that is already over.
 *
 * Date-level on purpose: a same-day time part whose hours have already passed
 * is still allowed (staff keep the whole day until midnight), and its finished
 * slots are then correctly unbookable via isSlotFinished — the two rules
 * compose rather than one having to guess the other's intent.
 */
export function assertWindowDateNotPast(
  slotDate: string,
  now: NowRef = nowRef(),
): void {
  if (isDatePast(slotDate, now)) {
    throw new ConflictException({
      message: `${slotDate} has already passed. Time parts can only be opened for today onwards.`,
      errorCode: 'WINDOW_DATE_IN_PAST',
    });
  }
}

/** A patient may book a slot right up until it ends, and never after. */
export function assertSlotBookable(
  slotDate: string,
  slotEnd: string,
  now: NowRef = nowRef(),
): void {
  if (isDatePast(slotDate, now)) {
    throw new ConflictException({
      message: 'That date has already passed.',
      errorCode: 'SLOT_DATE_IN_PAST',
    });
  }
  if (isSlotFinished(slotDate, slotEnd, now)) {
    throw new ConflictException({
      message: 'That slot has already finished.',
      errorCode: 'SLOT_FINISHED',
    });
  }
}

export interface DerivedSlot {
  slot_start: string;
  slot_end: string;
}

/**
 * Divides a time part into its slots — 10:00–13:00 at 30 minutes becomes
 * 10:00–10:30 … 12:30–13:00.
 *
 * This is the single definition of what slots exist. Nothing stores them, so
 * editing a window can never leave a stale slot row behind, and the client's
 * own preview can never disagree with what the server will accept.
 */
export function deriveSlots(
  startTime: string,
  endTime: string,
  slotMinutes: number,
): DerivedSlot[] {
  const from = hmToMinutes(startTime);
  const to = hmToMinutes(endTime);
  const slots: DerivedSlot[] = [];
  for (let cursor = from; cursor + slotMinutes <= to; cursor += slotMinutes) {
    slots.push({
      slot_start: minutesToHm(cursor),
      slot_end: minutesToHm(cursor + slotMinutes),
    });
  }
  return slots;
}

/**
 * Every rule the medical_appointment_windows CHECK constraints also enforce,
 * applied first so the caller gets a readable message instead of a raw
 * constraint-violation error.
 */
export function assertValidWindowShape(input: {
  start_time: string;
  end_time: string;
  slot_minutes: number;
  capacity_per_slot: number;
}): void {
  const from = hmToMinutes(input.start_time);
  const to = hmToMinutes(input.end_time);

  if (to <= from) {
    throw new BadRequestException({
      message: 'The end time must be after the start time.',
      errorCode: 'INVALID_TIME_RANGE',
    });
  }
  if (
    !ALLOWED_SLOT_MINUTES.includes(
      input.slot_minutes as (typeof ALLOWED_SLOT_MINUTES)[number],
    )
  ) {
    throw new BadRequestException({
      message: `Slot length must be one of ${ALLOWED_SLOT_MINUTES.join(', ')} minutes.`,
      errorCode: 'INVALID_SLOT_MINUTES',
    });
  }
  const span = to - from;
  if (span < input.slot_minutes) {
    throw new BadRequestException({
      message: `This time part is shorter than one ${input.slot_minutes}-minute slot.`,
      errorCode: 'WINDOW_TOO_SHORT',
    });
  }
  if (span % input.slot_minutes !== 0) {
    throw new BadRequestException({
      message: `${normaliseHm(input.start_time)}–${normaliseHm(input.end_time)} does not divide evenly into ${input.slot_minutes}-minute slots.`,
      errorCode: 'WINDOW_NOT_DIVISIBLE',
    });
  }
  if (input.capacity_per_slot < 1 || input.capacity_per_slot > 200) {
    throw new BadRequestException({
      message: 'Capacity per slot must be between 1 and 200.',
      errorCode: 'INVALID_CAPACITY',
    });
  }
}

/** Half-open overlap: 10:00–13:00 and 13:00–14:00 are adjacent, not overlapping. */
export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Serialises everything touching one date's time parts, so two staff members
 * adding overlapping windows at the same moment cannot both pass the overlap
 * check. A transaction-scoped advisory lock (not a session-scoped one) is
 * required here: DATABASE_URL points at the Supabase pooler in transaction
 * mode, where a session-level lock would outlive the connection's usefulness.
 */
export async function lockAppointmentDate(
  tx: Prisma.TransactionClient,
  slotDate: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${APPOINTMENT_LOCK_NAMESPACE}::int, hashtext(${slotDate}::text))`,
  );
}

let appointmentsSchemaPresent = false;

/**
 * True once every part of prisma/migrations/medical_appointments.sql is in
 * place: both new tables AND medical_visits.staff_id.
 *
 * staff_id is included deliberately — approve() inserts into it, so treating
 * the feature as ready without it would turn a partially applied migration into
 * a 500 at the moment a staff member presses Approve, which is the worst
 * possible time to discover it.
 *
 * Only a positive result is cached: a table cannot disappear, but it can be
 * created after the API is already running (the SQL is applied by hand), so a
 * negative result must stay re-checkable without a restart.
 */
export async function appointmentsSchemaReady(
  prisma: PrismaService,
): Promise<boolean> {
  if (appointmentsSchemaPresent) return true;

  const rows = await prisma.$queryRaw<{ ready: boolean }[]>(Prisma.sql`
    SELECT (
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'medical_appointment_windows')
      AND
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'medical_appointments')
      AND
      EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'medical_visits' AND column_name = 'staff_id')
    ) AS ready
  `);
  appointmentsSchemaPresent = rows[0]?.ready === true;
  return appointmentsSchemaPresent;
}

/**
 * Guard at the top of every appointment endpoint. Returns a 503 that names the
 * exact file to run, rather than letting a "relation does not exist" surface as
 * an opaque 500 if the schema has not been applied yet.
 */
export async function assertAppointmentsProvisioned(
  prisma: PrismaService,
): Promise<void> {
  if (await appointmentsSchemaReady(prisma)) return;
  throw new ServiceUnavailableException({
    message:
      'Appointment booking is not provisioned yet. Apply prisma/migrations/medical_appointments.sql, then retry.',
    errorCode: 'APPOINTMENTS_NOT_PROVISIONED',
  });
}

let visitStaffColumnPresent = false;

/**
 * True once medical_visits.staff_id exists.
 *
 * Separate from appointmentsSchemaReady above because the OPD queue needs this
 * one column and nothing else: it has to keep working exactly as before if the
 * appointment schema has not been applied yet, so the column is detected rather
 * than assumed. Positive-only caching, for the same reason as above.
 */
export async function visitStaffColumnReady(
  prisma: PrismaService,
): Promise<boolean> {
  if (visitStaffColumnPresent) return true;

  const rows = await prisma.$queryRaw<{ ready: boolean }[]>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'medical_visits' AND column_name = 'staff_id'
    ) AS ready
  `);
  visitStaffColumnPresent = rows[0]?.ready === true;
  return visitStaffColumnPresent;
}

export type PatientKind = 'student' | 'faculty' | 'staff';

export interface PatientIdentity {
  kind: PatientKind;
  student_id: number | null;
  faculty_id: number | null;
  staff_id: number | null;
}

/**
 * Maps the authenticated user onto whichever register actually holds them.
 *
 * Follows the same students → faculty → non_teaching_staff order the rest of
 * the codebase uses (see AttendanceService.resolveMarkerName and
 * HrPayrollService.resolveStaffByUserId): HoD is a faculty row, while
 * Secretary/HR/warden are non_teaching_staff rows, not faculty ones.
 *
 * A user in none of the three (e.g. a bare admin login) genuinely has no
 * patient record to attach a visit to, so booking is refused with a message
 * that says so rather than writing a nameless appointment.
 */
export async function resolvePatientIdentity(
  prisma: PrismaService,
  userId: number,
): Promise<PatientIdentity> {
  const student = await prisma.students.findFirst({
    where: { user_id: userId },
    select: { id: true },
  });
  if (student) {
    return {
      kind: 'student',
      student_id: student.id,
      faculty_id: null,
      staff_id: null,
    };
  }

  const faculty = await prisma.faculty.findFirst({
    where: { user_id: userId },
    select: { id: true },
  });
  if (faculty) {
    return {
      kind: 'faculty',
      student_id: null,
      faculty_id: faculty.id,
      staff_id: null,
    };
  }

  const staff = await prisma.non_teaching_staff.findFirst({
    where: { user_id: userId },
    select: { id: true },
  });
  if (staff) {
    return {
      kind: 'staff',
      student_id: null,
      faculty_id: null,
      staff_id: staff.id,
    };
  }

  throw new NotFoundException({
    message:
      'Your account is not linked to a student, faculty or staff record, so an appointment cannot be booked against it.',
    errorCode: 'PATIENT_RECORD_NOT_FOUND',
  });
}
