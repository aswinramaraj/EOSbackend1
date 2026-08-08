import { ArrayMinSize, IsArray, IsDateString, IsIn, IsInt, IsOptional, IsString, Min, MaxLength } from 'class-validator';
import { task_type_enum } from 'generated/prisma/client';

const TASK_TYPES = Object.values(task_type_enum);

/**
 * POST /me/lms/tasks (Faculty/HoD only).
 * class_ids fans out into one `assignments` row per class (Google
 * Classroom-style "assign to multiple classes") - each row still has its
 * own independent submissions/grading, only the creation step is shared.
 */
export class CreateTaskDto {
  @IsInt()
  subject_id: number;

  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  class_ids: number[];

  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  max_marks?: number;

  @IsIn(TASK_TYPES)
  task_type: task_type_enum;
}
