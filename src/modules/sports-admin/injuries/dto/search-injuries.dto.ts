import { IsIn, IsOptional } from 'class-validator';
import {
  sports_incident_type_enum,
  sports_injury_status_enum,
} from 'generated/prisma/client';

const VALID_INCIDENT_TYPES = Object.values(sports_incident_type_enum);
const VALID_INJURY_STATUSES = Object.values(sports_injury_status_enum);

export class SearchInjuriesDto {
  @IsOptional()
  @IsIn(VALID_INJURY_STATUSES, {
    message: `status must be a valid injury status value (${VALID_INJURY_STATUSES.join(', ')})`,
  })
  status?: sports_injury_status_enum;

  @IsOptional()
  @IsIn(VALID_INCIDENT_TYPES, {
    message: `incident_type must be a valid incident type value (${VALID_INCIDENT_TYPES.join(', ')})`,
  })
  incident_type?: sports_incident_type_enum;
}
