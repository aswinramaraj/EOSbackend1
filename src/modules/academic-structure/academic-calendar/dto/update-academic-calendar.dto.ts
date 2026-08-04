import { PartialType } from '@nestjs/mapped-types';
import { CreateAcademicCalendarDto } from './create-academic-calendar.dto';

export class UpdateAcademicCalendarDto extends PartialType(
  CreateAcademicCalendarDto,
) {}
