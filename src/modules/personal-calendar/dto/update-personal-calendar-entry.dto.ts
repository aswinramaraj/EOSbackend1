import { PartialType } from '@nestjs/mapped-types';
import { CreatePersonalCalendarEntryDto } from './create-personal-calendar-entry.dto';

export class UpdatePersonalCalendarEntryDto extends PartialType(
  CreatePersonalCalendarEntryDto,
) {}
