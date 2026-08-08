import { IsInt, IsOptional } from 'class-validator';

export class AssignAllotmentDto {
  @IsInt()
  student_id: number;

  @IsInt()
  room_id: number;

  @IsOptional()
  @IsInt()
  fee_structure_id?: number;
}
