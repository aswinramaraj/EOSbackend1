import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString } from 'class-validator';
import { CreateEquipmentDto } from './create-equipment.dto';

export class UpdateEquipmentDto extends PartialType(CreateEquipmentDto) {
  /** Optional free-text note logged alongside this update (see MediaRoomEquipmentService.update). */
  @IsOptional()
  @IsString()
  movement_note?: string;
}
