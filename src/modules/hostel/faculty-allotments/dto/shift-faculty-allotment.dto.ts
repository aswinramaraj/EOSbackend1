import { IsInt } from 'class-validator';

export class ShiftFacultyAllotmentDto {
  @IsInt()
  room_id: number;
}
