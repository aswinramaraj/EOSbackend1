import { IsInt } from 'class-validator';

export class ShiftAllotmentDto {
  @IsInt()
  room_id: number;
}
