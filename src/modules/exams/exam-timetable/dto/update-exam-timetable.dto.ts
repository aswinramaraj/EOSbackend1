// dto/update-exam-timetable.dto.ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateExamTimetableDto } from './create-exam-timetable.dto';

export class UpdateExamTimetableDto extends PartialType(
  CreateExamTimetableDto,
) {}
