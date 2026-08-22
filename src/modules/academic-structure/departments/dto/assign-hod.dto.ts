import { IsInt, IsOptional } from 'class-validator';

export class AssignHodDto {
  /** null clears the current HoD assignment. */
  @IsOptional()
  @IsInt()
  faculty_id!: number | null;
}
