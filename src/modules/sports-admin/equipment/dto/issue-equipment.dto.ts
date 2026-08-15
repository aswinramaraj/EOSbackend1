import { IsDateString, IsEnum, IsInt, IsOptional } from 'class-validator';
import { borrower_type_enum } from 'generated/prisma/client';

export class IssueEquipmentDto {
  @IsEnum(borrower_type_enum)
  issued_to_type: borrower_type_enum;

  @IsOptional()
  @IsInt()
  student_id?: number;

  @IsOptional()
  @IsInt()
  faculty_id?: number;

  @IsOptional()
  @IsDateString()
  due_date?: string;
}
