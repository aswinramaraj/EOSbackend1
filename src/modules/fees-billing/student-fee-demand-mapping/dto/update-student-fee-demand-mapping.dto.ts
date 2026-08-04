import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class UpdateStudentFeeDemandMappingDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  academic_year?: string;

  @IsOptional()
  @IsInt()
  semester?: number;
}
