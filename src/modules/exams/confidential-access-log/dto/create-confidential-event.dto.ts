import { Type } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength } from 'class-validator';

export class CreateConfidentialEventDto {
  @IsIn(['strong_room_entry', 'file_access', 'print_run', 'seal_break', 'exception'])
  event_type: 'strong_room_entry' | 'file_access' | 'print_run' | 'seal_break' | 'exception';

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  object_description: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  witness_user_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  witness_description?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  verification_method: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  question_paper_id?: number;
}
