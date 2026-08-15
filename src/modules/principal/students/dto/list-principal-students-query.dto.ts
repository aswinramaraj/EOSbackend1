import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export const PRINCIPAL_STUDENT_FILTERS = [
  'all',
  'attendance_below_75',
  'fees_pending',
] as const;
export type PrincipalStudentFilter = (typeof PRINCIPAL_STUDENT_FILTERS)[number];

export class ListPrincipalStudentsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  batch_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  department_id?: number;

  @IsOptional()
  @IsString()
  section?: string;

  @IsOptional()
  @IsIn(PRINCIPAL_STUDENT_FILTERS)
  filter?: PrincipalStudentFilter;
}
