import { IsDateString, IsOptional } from 'class-validator';

/** GET /sports-admin/sessions?date=YYYY-MM-DD — defaults to today when omitted. */
export class ListSessionsQueryDto {
  @IsOptional()
  @IsDateString({}, { message: 'date must be a valid ISO date' })
  date?: string;
}
