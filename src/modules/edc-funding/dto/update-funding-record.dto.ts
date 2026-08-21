import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateFundingRecordDto } from './create-funding-record.dto';

export class UpdateFundingRecordDto extends PartialType(
  OmitType(CreateFundingRecordDto, ['student_entrepreneurship_id'] as const),
) {}
