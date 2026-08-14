import { IsEnum, IsOptional } from 'class-validator';
import { borrow_status_enum } from 'generated/prisma/client';

export class SearchEquipmentIssuesDto {
  @IsOptional()
  @IsEnum(borrow_status_enum)
  status?: borrow_status_enum;
}
