import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Min,
} from 'class-validator';

const OFFER_RESPONSES = ['accepted', 'pending', 'declined'] as const;

/**
 * The reference design's "Add student entry" popup for Placements — one
 * call that both maps the student to the drive (real student_drive_applications
 * insert) and records the real offer details on that same row, instead of
 * a bare "applied" row the IQAC user would have to edit again separately.
 */
export class AddPlacementEntryDto {
  @IsInt()
  @IsPositive()
  student_id: number;

  @IsOptional()
  @IsIn(OFFER_RESPONSES)
  offer_response?: 'accepted' | 'pending' | 'declined';

  @IsOptional()
  @IsNumber()
  @Min(0)
  offered_package_lpa?: number;

  /** Real once the additive offer_date column exists — see IqacStudentDevelopmentService.addPlacementEntry(). */
  @IsOptional()
  @IsDateString()
  offer_date?: string;
}
