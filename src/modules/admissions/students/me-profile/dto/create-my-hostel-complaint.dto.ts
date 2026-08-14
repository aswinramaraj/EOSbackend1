import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { hostel_complaint_category_enum } from 'generated/prisma/client';

export class CreateMyHostelComplaintDto {
  @IsEnum(hostel_complaint_category_enum)
  category: hostel_complaint_category_enum;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
}
