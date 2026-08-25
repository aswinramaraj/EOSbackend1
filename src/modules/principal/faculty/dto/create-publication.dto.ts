import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePublicationDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  faculty_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  type: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  venue?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  doi?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  citation_count?: number;
}
