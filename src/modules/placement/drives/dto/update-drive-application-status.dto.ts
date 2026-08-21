import {
  IsDateString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { drive_application_status_enum } from '../../../../../generated/prisma/enums';

const OFFER_RESPONSES = ['accepted', 'pending', 'declined'] as const;
export type OfferResponse = (typeof OFFER_RESPONSES)[number];

export class UpdateDriveApplicationStatusDto {
  @IsOptional()
  @IsEnum(drive_application_status_enum)
  status?: drive_application_status_enum;

  @IsOptional()
  @IsIn(OFFER_RESPONSES)
  offer_response?: OfferResponse;

  /** The actual package offered to this student — can differ from the drive's advertised package_lpa. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  offered_package_lpa?: number;

  // joining_date/work_location are real once query.md #16 runs
  // (`student_drive_applications` gets the columns) — until then these are
  // accepted but silently dropped by the $queryRaw fallback in the service.
  @IsOptional()
  @IsDateString()
  joining_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  work_location?: string;
}
