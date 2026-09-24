import { IsDateString } from 'class-validator';

/**
 * GET /me/timetable-requests/colleagues (Faculty/HoD). `date` is required —
 * this endpoint only exists to power the take-over/swap request-creation
 * picker, which always has a specific date in hand (the period being
 * requested against).
 */
export class ListColleaguesQueryDto {
  @IsDateString()
  date: string;
}
