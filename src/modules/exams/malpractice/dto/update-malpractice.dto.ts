import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsIn, IsOptional, MaxLength } from 'class-validator';
import { CreateMalpracticeDto } from './create-malpractice.dto';

export class UpdateMalpracticeDto extends PartialType(CreateMalpracticeDto) {
  @IsOptional()
  @IsIn(['reported', 'under_enquiry', 'decided'])
  enquiry_stage?: 'reported' | 'under_enquiry' | 'decided';

  @IsOptional()
  @IsDateString()
  committee_sitting_at?: string;

  @IsOptional()
  @IsIn(['pending', 'upheld', 'dismissed'])
  @MaxLength(20)
  appeal_status?: string;
}
