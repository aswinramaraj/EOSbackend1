import { IsDateString, IsString, MaxLength, MinLength } from 'class-validator';

/** POST /hod/class-records/student/:id/meeting-notes */
export class CreateMeetingNoteDto {
  @IsDateString({}, { message: 'meeting_date must be a valid ISO date' })
  meeting_date: string;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  note: string;
}
