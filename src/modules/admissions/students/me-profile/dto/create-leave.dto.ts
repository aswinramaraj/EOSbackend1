import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * from_date/to_date are checked here only for "present and a valid date
 * string" (400 VALIDATION_ERROR territory). The business rule — not in the
 * past, from_date <= to_date — is checked in MeLeavesService as 422
 * INVALID_DATE_RANGE (a distinct errorCode the global ValidationPipe can't
 * produce), matching the DTO/service split used throughout this module.
 */
export class CreateLeaveDto {
  @IsDateString()
  from_date: string;

  @IsDateString()
  to_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @IsOptional()
  @IsBoolean()
  also_on_hostel_leave?: boolean;

  /**
   * Set only by the Hostel tab's own "Leave" form (never by the academic
   * Leave tab) - routes this request straight to the Warden, skipping
   * Faculty/HoD entirely. See MeLeavesService.createLeave() for the
   * accompanying NOT_A_HOSTELLER gate and student-leaves.service.ts for why
   * these rows never enter the mentor/HoD review queue.
   */
  @IsOptional()
  @IsBoolean()
  routed_to_warden?: boolean;
}
