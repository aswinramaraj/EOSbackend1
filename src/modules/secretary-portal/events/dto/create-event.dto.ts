import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';

export class CreateEventDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  kind: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  event_date: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  venue_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  owner_faculty_id?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity: number;
}
