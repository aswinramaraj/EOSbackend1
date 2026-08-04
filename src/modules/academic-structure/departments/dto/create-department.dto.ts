import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateDepartmentDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Department name and code are required' })
  @MaxLength(255, { message: 'Department name must not exceed 255 characters' })
  name: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'Department name and code are required' })
  @MaxLength(20, { message: 'Department code must not exceed 20 characters' })
  code: string;
}
