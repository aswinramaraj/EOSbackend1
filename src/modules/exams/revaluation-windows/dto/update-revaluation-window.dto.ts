import { PartialType, OmitType } from '@nestjs/mapped-types';
import { CreateRevaluationWindowDto } from './create-revaluation-window.dto';

export class UpdateRevaluationWindowDto extends PartialType(
  OmitType(CreateRevaluationWindowDto, ['exam_id'] as const),
) {}
