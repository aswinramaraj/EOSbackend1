import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { personal_calendar_entry_category_enum } from '../../../../../generated/prisma/client';

export class AddPersonalEntryDto {
  @IsDateString()
  entry_date!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  details?: string;

  @IsEnum(personal_calendar_entry_category_enum)
  category!: personal_calendar_entry_category_enum;
}
