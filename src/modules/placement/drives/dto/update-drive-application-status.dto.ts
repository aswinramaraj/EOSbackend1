import { IsEnum, IsIn, IsNumber, IsOptional, Min } from 'class-validator';
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
}
