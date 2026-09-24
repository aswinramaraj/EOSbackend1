import { IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';

export class RespondPeriodRequestDto {
  @IsIn(['accepted', 'rejected'])
  decision: 'accepted' | 'rejected';

  /**
   * Take-over accept only — the subject the covering faculty will actually
   * teach that period (their own subject, not the original teacher's).
   * Optional: accepting without one just shows "Covering" with no subject
   * swap, rather than forcing a pick when the frontend has nothing sensible
   * to offer (e.g. the covering faculty doesn't teach this class at all).
   */
  @IsOptional()
  @IsInt()
  @IsPositive()
  covering_subject_id?: number;
}
