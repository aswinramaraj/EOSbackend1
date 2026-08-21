import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateStartupIdeaDto {
  @IsInt()
  student_id!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsString()
  problem_statement?: string;

  @IsOptional()
  @IsString()
  solution?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  target_customers?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  market_size?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  competitors?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  team_note?: string;

  @IsOptional()
  @IsNumber()
  budget_needed?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  feasibility_score?: number;

  @IsOptional()
  @IsIn(['Low', 'Medium', 'High'])
  feasibility_confidence?: 'Low' | 'Medium' | 'High';

  @IsOptional()
  @IsString()
  @MaxLength(255)
  attachments_note?: string;

  @IsOptional()
  @IsInt()
  mentor_faculty_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  target_milestone?: string;
}
