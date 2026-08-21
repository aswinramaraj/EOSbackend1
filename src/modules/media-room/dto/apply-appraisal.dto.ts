import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

class AppraisalEntryInput {
  @IsInt()
  criteria_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class ApplyAppraisalDto {
  @IsString()
  @MaxLength(20)
  academic_year: string;

  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => AppraisalEntryInput)
  entries: AppraisalEntryInput[];
}
