import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateQuitRequestDto {
  @IsInt()
  student_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}
