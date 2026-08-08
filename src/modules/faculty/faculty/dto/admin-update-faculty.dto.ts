import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { CreateSensitiveInfoDto } from './create-sensitive-info.dto';
import { FacultyExtendedFieldsDto } from './faculty-extended-fields.dto';

/**
 * PATCH /faculty/:id — Admin-only edit of any faculty record.
 *
 * Distinct from UpdateFacultyDto (the faculty's own /profile self-update):
 * this DTO exposes the admin-controlled fields (designation, department_id,
 * status, date_of_joining) that a faculty member is explicitly NOT allowed
 * to change themselves. `user_id` is intentionally never editable post-creation.
 *
 * `status` also propagates to the linked users.status (see FacultyService.updateByAdmin)
 * so that deactivating a faculty also blocks their login, consistent with
 * AuthService's ACCOUNT_INACTIVE check.
 */
export class AdminUpdateFacultyDto extends FacultyExtendedFieldsDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  first_name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  last_name?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  designation?: string;

  @IsOptional()
  @IsInt()
  department_id?: number;

  @IsOptional()
  @IsDateString({}, { message: 'date_of_joining must be a valid ISO date' })
  date_of_joining?: string;

  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s()]{7,20}$/, {
    message: 'Please provide a valid phone number',
  })
  phone?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSensitiveInfoDto)
  sensitive_info?: CreateSensitiveInfoDto;
}
