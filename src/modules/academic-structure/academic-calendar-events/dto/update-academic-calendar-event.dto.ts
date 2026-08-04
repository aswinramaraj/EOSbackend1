import { PartialType } from '@nestjs/mapped-types';
import { CreateAcademicCalendarEventDto } from './create-academic-calendar-event.dto';

export class UpdateAcademicCalendarEventDto extends PartialType(
  CreateAcademicCalendarEventDto,
) {}
