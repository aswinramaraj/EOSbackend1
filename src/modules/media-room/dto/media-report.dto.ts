import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const REPORT_STATUSES = ['draft', 'final'] as const;

const trim = Transform(({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value,
);

const optionalText = Transform(({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const t = value.trim();
  return t.length === 0 ? undefined : t;
});

export class CreateReportDto {
  @trim
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name: string;

  @trim
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  period: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(4000)
  note?: string;
}

export class UpdateReportDto {
  @IsOptional()
  @IsIn(REPORT_STATUSES)
  status?: (typeof REPORT_STATUSES)[number];

  @IsOptional()
  @trim
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @trim
  @IsString()
  @MinLength(3)
  @MaxLength(100)
  period?: string;

  @IsOptional()
  @optionalText
  @IsString()
  @MaxLength(4000)
  note?: string;
}

/**
 * A scorecard target. `metric_key` arrives as a path parameter, so it is
 * constrained to the same snake_case shape the metric catalogue uses rather
 * than accepted as free text.
 */
export class SetScorecardTargetDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99_999_999)
  target_value: number;
}

export class ScorecardTargetParamDto {
  @Matches(/^[a-z][a-z0-9_]{1,49}$/, {
    message: 'metric_key must be lower snake_case',
  })
  metricKey: string;
}
