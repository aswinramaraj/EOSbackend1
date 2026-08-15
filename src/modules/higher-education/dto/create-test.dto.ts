import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Min, MaxLength } from 'class-validator';

const READINESS = ['on_track', 'watch', 'behind'] as const;

/** POST /me/higher-education-test-register — upserts by test_name; enrolled/cleared/next-window/readiness are the coordinator's own typed-in fields. */
export class CreateTestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  test_name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  enrolled_count?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cleared_count?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  next_window_label?: string;

  @IsOptional()
  @IsDateString()
  next_window_date?: string;

  @IsOptional()
  @IsIn(READINESS)
  readiness?: (typeof READINESS)[number];
}
