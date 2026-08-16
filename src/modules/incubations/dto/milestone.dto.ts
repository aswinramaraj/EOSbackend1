import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const MILESTONE_STATUSES = ['Upcoming', 'In Progress', 'Completed'] as const;

export class CreateMilestoneDto {
  @IsString()
  @MaxLength(150)
  label: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsIn(MILESTONE_STATUSES)
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress_percent?: number;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}

export class UpdateMilestoneDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  label?: string;

  @IsOptional()
  @IsDateString()
  due_date?: string;

  @IsOptional()
  @IsIn(MILESTONE_STATUSES)
  status?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  progress_percent?: number;

  @IsOptional()
  @IsInt()
  sort_order?: number;
}
