import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const SHOOT_STATUSES = [
  'planned',
  'confirmed',
  'delivered',
  'cancelled',
] as const;

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

const optionalText = Transform(({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t.length === 0 ? undefined : t;
});

/**
 * A shoot is raised either against an existing media request or as a
 * standalone calendar entry — never both, and never neither. The database
 * enforces that with a check constraint; the service checks it first so the
 * caller gets a 422 explaining the rule instead of a raw constraint violation.
 */
export class CreateShootAssignmentDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  media_request_id?: number;

  @IsOptional()
  @optionalText
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  event_title?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(255)
  venue?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assigned_to_member_id?: number;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(255)
  crew?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(255)
  gear_issued?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(100)
  output_type?: string;

  @IsOptional()
  @IsISO8601(
    { strict: false },
    { message: 'scheduled_at must be an ISO-8601 date-time' },
  )
  scheduled_at?: string;
}

export class UpdateShootAssignmentDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assigned_to_member_id?: number;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(255)
  crew?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(255)
  gear_issued?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(100)
  output_type?: string;

  @IsOptional()
  @IsISO8601(
    { strict: false },
    { message: 'scheduled_at must be an ISO-8601 date-time' },
  )
  scheduled_at?: string;

  @IsOptional()
  @IsIn(SHOOT_STATUSES)
  status?: (typeof SHOOT_STATUSES)[number];

  @IsOptional()
  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  event_title?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(255)
  venue?: string;
}
