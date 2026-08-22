import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class CreateClassDto {
  @Type(() => Number)
  @IsInt({ message: 'batch_id must be an integer' })
  @IsPositive({ message: 'batch_id must be a positive integer' })
  batch_id: number;

  @Type(() => Number)
  @IsInt({ message: 'department_id must be an integer' })
  @IsPositive({ message: 'department_id must be a positive integer' })
  department_id: number;

  @Type(() => Number)
  @IsInt({ message: 'course_id must be an integer' })
  @IsPositive({ message: 'course_id must be a positive integer' })
  course_id: number;

  // Not restricted to A-D — that was a UI convention, not a real constraint;
  // the db column is just varchar(10). Uppercased so "a" and "A" collide
  // against the real @@unique([batch_id, course_id, section]) instead of
  // silently coexisting as "different" sections.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Section is required' })
  @MaxLength(10, { message: 'Section must not exceed 10 characters' })
  @Matches(/^[A-Z0-9]+$/, {
    message: 'Section may only contain letters and numbers',
  })
  section: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'current_semester must be an integer' })
  @IsPositive({ message: 'current_semester must be a positive integer' })
  current_semester?: number;
}
