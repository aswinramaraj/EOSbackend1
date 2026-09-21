import { IsEnum } from 'class-validator';
import { photocopy_status_enum } from 'generated/prisma/client';
import { OptionalRemarks } from '../../../../common/dto/decision-reason.dto';

export class UpdatePhotocopyRequestDto {
  @IsEnum(photocopy_status_enum, {
    message: `status must be one of: ${Object.values(photocopy_status_enum).join(', ')}`,
  })
  status!: photocopy_status_enum;

  // Real once decision_reason_columns.query.md's photocopy_requests.decision_remarks runs.
  @OptionalRemarks()
  decision_remarks?: string;
}
