import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { OptionalRemarks } from '../../../../common/dto/decision-reason.dto';

/** One entry's score, supplied by HR Payroll when transitioning a request to 'hr_scored'. */
export class AppraisalEntryScoreDto {
  @IsInt()
  entry_id: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  score: number;
}

/**
 * PATCH /appraisal/:id (HoD or HR Payroll only).
 *
 * Intentionally NOT PartialType(CreateAppraisalDto): this is a state-machine
 * transition, not a free-form edit. `status` is required and its valid
 * values (and whether `entries` may/must accompany it) depend on the
 * caller's role and the request's current status — enforced in the service,
 * since neither of those is knowable from the DTO alone.
 *
 * `remarks` is a real column (`appraisal_requests.hod_remarks`, already read
 * back by getDetail()) for the HoD's own "send back" reason — previously
 * accepted by the frontend and this DTO's own `status` transition but never
 * actually persisted by applyHodReview(), silently discarding it.
 */
export class UpdateAppraisalDto {
  @IsIn(['hod_reviewed', 'hr_scored', 'management_approved', 'rejected'])
  status: 'hod_reviewed' | 'hr_scored' | 'management_approved' | 'rejected';

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AppraisalEntryScoreDto)
  entries?: AppraisalEntryScoreDto[];

  @OptionalRemarks()
  remarks?: string;
}
