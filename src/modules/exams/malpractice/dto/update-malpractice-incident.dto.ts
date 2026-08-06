import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { MalpracticeAction } from './create-malpractice-incident.dto';

/** Only the outcome can be revised after the fact — the incident's who/what/when is fixed at creation. */
export class UpdateMalpracticeIncidentDto {
  @IsOptional()
  @IsEnum(MalpracticeAction, { message: 'Invalid action_taken value' })
  action_taken?: MalpracticeAction;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  invigilator_remarks?: string;
}
