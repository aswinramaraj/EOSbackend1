import { IsDateString, IsOptional } from 'class-validator';

/** GET /me/hostel-night-attendance?from=&to= — both optional; omitting either falls back to the last 90 published records. */
export class GetHostelNightAttendanceDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
