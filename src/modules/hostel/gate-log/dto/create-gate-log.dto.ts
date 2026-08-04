import { IsEnum, IsInt, IsOptional } from 'class-validator';
import { entry_type_enum } from 'generated/prisma/client';

export class CreateGateLogDto {
  @IsInt()
  student_id: number;

  @IsEnum(entry_type_enum)
  entry_type: entry_type_enum;

  @IsOptional()
  @IsInt()
  outing_id?: number;
}
