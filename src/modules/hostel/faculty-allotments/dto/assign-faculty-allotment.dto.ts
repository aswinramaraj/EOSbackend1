import { IsInt, IsOptional } from 'class-validator';

export class AssignFacultyAllotmentDto {
  @IsInt()
  faculty_id: number;

  @IsInt()
  room_id: number;

  @IsOptional()
  @IsInt()
  fee_structure_id?: number;
}
