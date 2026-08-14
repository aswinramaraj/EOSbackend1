import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  sports_facility_status_enum,
  sports_facility_type_enum,
} from 'generated/prisma/client';

export class CreateFacilityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  location?: string;

  @IsOptional()
  @IsEnum(sports_facility_type_enum)
  facility_type?: sports_facility_type_enum;

  @IsOptional()
  @IsInt()
  @Min(0)
  capacity?: number;

  @IsOptional()
  @IsEnum(sports_facility_status_enum)
  status?: sports_facility_status_enum;
}
