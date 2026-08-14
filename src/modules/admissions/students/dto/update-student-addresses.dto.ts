import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * One row of PATCH /students/:id/addresses. address_type is checked for
 * "present and a string" here only; real address_type_enum membership
 * (permanent | temporary) is checked in StudentsService, same split used by
 * PerfectEntryAddressDto/SoaApplicationsService for the identical fields at
 * admission time.
 */
export class UpdateStudentAddressDto {
  @IsString()
  @IsNotEmpty({ message: 'address_type is required for each address entry' })
  address_type: string;

  @IsOptional() @IsString() @MaxLength(500) address_line?: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) state?: string;
  @IsOptional() @IsString() @MaxLength(15) pincode?: string;
}

/**
 * PATCH /students/:id/addresses (Admin only) — the fix for addresses that
 * were left incomplete (or wrong) at admission time, since perfect-entry's
 * own address fields can otherwise never be revisited. Each entry is
 * upserted by (student_id, address_type) — sending "permanent" again
 * overwrites that row in place, it never creates a duplicate.
 */
export class UpdateStudentAddressesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateStudentAddressDto)
  addresses: UpdateStudentAddressDto[];
}
