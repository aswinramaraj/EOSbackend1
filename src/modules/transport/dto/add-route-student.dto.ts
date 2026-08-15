import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/** POST /me/routes/:id/students — Transport office only. Adds a student, or moves their existing transport assignment onto this route (student_transport_mapping.student_id is unique — one assignment per student). */
export class AddRouteStudentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  student_id_no!: string;

  @Type(() => Number)
  @IsInt()
  boarding_stage_id!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  bus_id?: number;
}
