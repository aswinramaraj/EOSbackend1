import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

/** POST /me/medical-centre-opd-queue — identifies the visitor by their real student ID number or email. */
export class CreateWalkinDto {
  @IsIn(['student', 'faculty'])
  visitor_type!: 'student' | 'faculty';

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  identifier!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  attended_by_staff_id?: number;

  /** Defaults to true (added to the live queue) when omitted, matching the OPD page's existing "Add walk-in" behaviour. */
  @IsOptional()
  @IsBoolean()
  to_queue?: boolean;
}
