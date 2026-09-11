import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Appointment booking DTOs — medical centre.
 *
 * Times are "HH:mm" 24-hour. Seconds are tolerated on input because some
 * browsers' <input type="time"> emits "HH:mm:ss", but everything is normalised
 * to "HH:mm" before it reaches SQL (see normaliseHm in
 * medical-appointments.util.ts) so a stored value never depends on which
 * browser sent it.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

/** Slot lengths a time part may be divided into — must match the CHECK constraint on medical_appointment_windows.slot_minutes. */
export const ALLOWED_SLOT_MINUTES = [10, 15, 20, 30, 60] as const;

export class CreateAppointmentWindowDto {
  @Matches(DATE_ONLY, { message: 'slot_date must be in YYYY-MM-DD format' })
  slot_date!: string;

  @Matches(TIME_OF_DAY, {
    message: 'start_time must be in HH:mm 24-hour format',
  })
  start_time!: string;

  @Matches(TIME_OF_DAY, { message: 'end_time must be in HH:mm 24-hour format' })
  end_time!: string;

  /** Defaults to 30 minutes — the length the booking UI is designed around. */
  @IsOptional()
  @IsInt()
  @IsIn(ALLOWED_SLOT_MINUTES, {
    message: `slot_minutes must be one of ${ALLOWED_SLOT_MINUTES.join(', ')}`,
  })
  slot_minutes?: number;

  /** Defaults to 10 people per slot. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  capacity_per_slot?: number;
}

export class UpdateAppointmentWindowDto {
  @IsOptional()
  @Matches(TIME_OF_DAY, {
    message: 'start_time must be in HH:mm 24-hour format',
  })
  start_time?: string;

  @IsOptional()
  @Matches(TIME_OF_DAY, { message: 'end_time must be in HH:mm 24-hour format' })
  end_time?: string;

  @IsOptional()
  @IsInt()
  @IsIn(ALLOWED_SLOT_MINUTES, {
    message: `slot_minutes must be one of ${ALLOWED_SLOT_MINUTES.join(', ')}`,
  })
  slot_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  capacity_per_slot?: number;

  @IsOptional()
  @IsIn(['open', 'closed'])
  status?: 'open' | 'closed';
}

/** GET /windows?from=&to= — the visible month on the calendar. */
export class WindowRangeQueryDto {
  @Matches(DATE_ONLY, { message: 'from must be in YYYY-MM-DD format' })
  from!: string;

  @Matches(DATE_ONLY, { message: 'to must be in YYYY-MM-DD format' })
  to!: string;
}

/** GET /slots?date= */
export class DayQueryDto {
  @Matches(DATE_ONLY, { message: 'date must be in YYYY-MM-DD format' })
  date!: string;
}

/** GET /bookings?date=&start= — who booked one derived slot. */
export class SlotBookingsQueryDto {
  @Matches(DATE_ONLY, { message: 'date must be in YYYY-MM-DD format' })
  date!: string;

  @Matches(TIME_OF_DAY, { message: 'start must be in HH:mm 24-hour format' })
  start!: string;
}

/** POST /bookings/:id/approve | /reject */
export class AppointmentDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  note?: string;
}

/**
 * POST /me/medical-appointments — a booking by the signed-in user.
 *
 * There is deliberately no patient/user field: who is booking comes from the
 * JWT, so one account can never create a booking in another person's name.
 * `slot_start` only selects which division of the window is wanted; the server
 * re-derives the slot's real bounds from the window row.
 */
export class CreateAppointmentDto {
  @IsInt()
  @Min(1)
  window_id!: number;

  @Matches(TIME_OF_DAY, {
    message: 'slot_start must be in HH:mm 24-hour format',
  })
  slot_start!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

/** GET /me/medical-appointments/availability?from=&to= */
export class AvailabilityRangeQueryDto {
  @Matches(DATE_ONLY, { message: 'from must be in YYYY-MM-DD format' })
  from!: string;

  @Matches(DATE_ONLY, { message: 'to must be in YYYY-MM-DD format' })
  to!: string;
}
