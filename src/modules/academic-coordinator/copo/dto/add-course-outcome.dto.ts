import { IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddCourseOutcomeDto {
  @IsInt()
  subject_id!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;
}
