import { IsEnum } from 'class-validator';
import { photocopy_status_enum } from 'generated/prisma/client';

export class UpdatePhotocopyRequestDto {
  @IsEnum(photocopy_status_enum, {
    message: `status must be one of: ${Object.values(photocopy_status_enum).join(', ')}`,
  })
  status!: photocopy_status_enum;
}
