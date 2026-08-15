import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Min, MaxLength } from 'class-validator';

/** POST /me/higher-education-application-windows — applicants/documents-pending/deadline are the coordinator's own typed-in fields. */
export class CreateApplicationWindowDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  university!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  country!: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  intake?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  applicants_count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  documents_pending?: number;

  @IsOptional()
  @IsDateString()
  deadline?: string;
}
