import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  sports_incident_type_enum,
  sports_injury_status_enum,
} from 'generated/prisma/client';

const VALID_INCIDENT_TYPES = Object.values(sports_incident_type_enum);
const VALID_INJURY_STATUSES = Object.values(sports_injury_status_enum);

export class CreateInjuryDto {
  @IsIn(VALID_INCIDENT_TYPES, {
    message: `incident_type must be a valid incident type value (${VALID_INCIDENT_TYPES.join(', ')})`,
  })
  incident_type: sports_incident_type_enum;

  /** Required when incident_type is 'injury'. */
  @IsOptional()
  @IsInt()
  student_id?: number;

  /** Required when incident_type is 'facility'. */
  @IsOptional()
  @IsInt()
  facility_id?: number;

  @IsOptional()
  @IsInt()
  discipline_id?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  incident: string;

  @IsDateString()
  incident_date: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  care_notes?: string;

  @IsOptional()
  @IsIn(VALID_INJURY_STATUSES, {
    message: `status must be a valid injury status value (${VALID_INJURY_STATUSES.join(', ')})`,
  })
  status?: sports_injury_status_enum;

  @IsOptional()
  @IsDateString()
  return_to_play_date?: string;

  @IsOptional()
  @IsInt()
  medical_visit_id?: number;
}
