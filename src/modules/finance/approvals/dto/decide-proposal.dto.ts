import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Finance's decision on a POP/SOP.
 *
 * `amount` is what actually leaves the fund, so it is a required, bounded
 * input on approval rather than being inferred from the indent's estimate —
 * Finance sanctions a figure explicitly and it is recorded against the ledger
 * entry. On rejection no money moves, so no amount is accepted at all.
 */
export class DecideProposalDto {
  @IsIn(['approve', 'reject'])
  decision: 'approve' | 'reject';

  /** Required on approval, forbidden on rejection. */
  @ValidateIf((o: DecideProposalDto) => o.decision === 'approve')
  @Type(() => Number)
  @IsInt({ message: 'amount must be a whole number of rupees' })
  @Min(1, { message: 'An approved amount must be at least 1' })
  @Max(999_999_999_999)
  amount?: number;

  /** A rejection must say why; an approval may add a note. */
  @ValidateIf((o: DecideProposalDto) => o.decision === 'reject')
  @IsString()
  @IsNotEmpty({ message: 'A reason is required when rejecting' })
  @MaxLength(1000)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  remarks?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fund_id?: number;

  /**
   * The faculty member this order is being approved for. Optional, and
   * recorded as an intent only — actual custody is still only created once the
   * order is delivered (finance_order_allotments enforces that in the DB).
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'assigned_faculty_id must be a faculty id' })
  @Min(1)
  assigned_faculty_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  assignment_note?: string;
}
