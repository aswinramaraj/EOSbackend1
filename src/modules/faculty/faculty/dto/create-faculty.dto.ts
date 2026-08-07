import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';
import { CreateSensitiveInfoDto } from './create-sensitive-info.dto';
import { FacultyExtendedFieldsDto } from './faculty-extended-fields.dto';

/**
 * POST /faculty (Admin only).
 * Creates the users record, faculty record and (optionally) faculty_sensitive_info
 * record in a single transaction. `email` becomes the new faculty's login;
 * a temporary password is generated server-side and returned once in the response.
 */
export class CreateFacultyDto extends FacultyExtendedFieldsDto {
  @IsEmail({}, { message: 'Please provide a valid email address' })
  email: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9+\-\s()]{7,20}$/, {
    message: 'Please provide a valid phone number',
  })
  phone?: string;

  @IsString()
  @IsNotEmpty()
  first_name: string;

  @IsString()
  @IsNotEmpty()
  last_name: string;

  @IsString()
  @IsNotEmpty()
  designation: string;

  @IsInt()
  department_id: number;

  @IsOptional()
  @IsDateString({}, { message: 'date_of_joining must be a valid ISO date' })
  date_of_joining?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CreateSensitiveInfoDto)
  sensitive_info?: CreateSensitiveInfoDto;
}
