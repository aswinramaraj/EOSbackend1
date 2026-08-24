import { IsBoolean, IsInt, IsOptional } from 'class-validator';

export class MarkHodAssignmentStatusDto {
  @IsInt()
  assignment_id: number;

  @IsInt()
  student_id: number;

  @IsOptional()
  @IsInt()
  status_id: number | null;

  @IsBoolean()
  is_submitted: boolean;
}
