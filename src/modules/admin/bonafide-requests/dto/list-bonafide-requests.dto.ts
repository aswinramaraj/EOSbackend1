import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

const BONAFIDE_STATUSES = [
  'pending',
  'faculty_approved',
  'issued',
  'rejected',
] as const;

/** GET /admin/bonafide-requests — query filters, layered on the project's shared pagination convention. */
export class ListBonafideRequestsDto extends PaginationDto {
  @IsOptional()
  @IsIn(BONAFIDE_STATUSES)
  status?: (typeof BONAFIDE_STATUSES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  reason_id?: number;

  @IsOptional()
  @IsString()
  q?: string; // searches student_id_no, register_no, roll_no, admission_no, name

  @IsOptional()
  @IsDateString()
  from?: string; // requested_at >=

  @IsOptional()
  @IsDateString()
  to?: string; // requested_at <=
}
