import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * POST /sports-admin/teams/:id/roster
 * Upsert semantics: if the [student_id, team_id] pair already exists, jersey_no/squad_role
 * are simply updated instead of raising a conflict.
 */
export class AddRosterEntryDto {
  @IsInt()
  student_id: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  jersey_no?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  squad_role?: string;
}
