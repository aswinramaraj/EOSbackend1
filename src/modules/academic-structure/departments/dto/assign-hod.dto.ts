import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

export class AssignHodDto {
  /** null clears the current HoD assignment. */
  @IsOptional()
  @IsInt()
  faculty_id!: number | null;

  /** Recorded on the audit_logs row this write creates — not stored on departments itself. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
