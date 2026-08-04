import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateExamTypeDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Exam Type name is required.' })
  @MaxLength(50, { message: 'Exam Type name must not exceed 50 characters.' })
  name: string;
}
