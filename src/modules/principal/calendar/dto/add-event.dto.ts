import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AcademicCalendarEventType } from 'src/modules/academic-structure/academic-calendar-events/dto/create-academic-calendar-event.dto';

export class AddPrincipalEventDto {
  @IsDateString()
  event_date!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsEnum(AcademicCalendarEventType)
  event_type!: AcademicCalendarEventType;
}
