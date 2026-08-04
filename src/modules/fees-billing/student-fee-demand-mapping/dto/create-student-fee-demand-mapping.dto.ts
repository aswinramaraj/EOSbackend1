import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class CreateStudentFeeDemandMappingDto {
  @IsInt()
  student_id: number;

  @IsInt()
  fee_structure_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  academic_year: string;

  @IsOptional()
  @IsInt()
  semester?: number;
}
