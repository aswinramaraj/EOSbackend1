import { IsEnum, IsOptional } from 'class-validator';
import {
  sports_facility_status_enum,
  sports_facility_type_enum,
} from 'generated/prisma/client';

export class SearchFacilitiesDto {
  @IsOptional()
  @IsEnum(sports_facility_status_enum)
  status?: sports_facility_status_enum;

  @IsOptional()
  @IsEnum(sports_facility_type_enum)
  facility_type?: sports_facility_type_enum;
}
