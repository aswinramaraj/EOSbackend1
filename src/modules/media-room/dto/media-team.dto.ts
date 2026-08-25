import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const TEAM_MEMBER_STATUSES = ['active', 'inactive'] as const;

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

const optionalText = Transform(({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t.length === 0 ? undefined : t;
});

export class CreateTeamMemberDto {
  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  full_name: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(100)
  designation?: string;

  @IsOptional()
  @optionalText
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @optionalText
  @Matches(/^[0-9+\-\s()]{6,20}$/, {
    message: 'phone may contain only digits, spaces and + - ( )',
  })
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(1000)
  skills?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(1000)
  photo_url?: string;

  @IsOptional()
  @IsDateString({}, { message: 'joined_on must be a date (YYYY-MM-DD)' })
  joined_on?: string;
}

export class UpdateTeamMemberDto {
  @IsOptional()
  @trim
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  full_name?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(100)
  designation?: string;

  @IsOptional()
  @optionalText
  @IsEmail({}, { message: 'email must be a valid address' })
  @MaxLength(150)
  email?: string;

  @IsOptional()
  @optionalText
  @Matches(/^[0-9+\-\s()]{6,20}$/, {
    message: 'phone may contain only digits, spaces and + - ( )',
  })
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(1000)
  skills?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(1000)
  photo_url?: string;

  @IsOptional()
  @IsIn(TEAM_MEMBER_STATUSES)
  status?: (typeof TEAM_MEMBER_STATUSES)[number];

  @IsOptional()
  @IsDateString({}, { message: 'joined_on must be a date (YYYY-MM-DD)' })
  joined_on?: string;
}
