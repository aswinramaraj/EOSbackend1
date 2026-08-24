import { Type } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

/**
 * POST /me/routes — Transport office only.
 *
 * `name` is the only required field and is unique in the database: a route is
 * identified by its name across buses, stages and student mappings, so the
 * service turns a duplicate into a 409 rather than a server error.
 */
export class CreateRouteDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  boarding_area?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  distance_km?: number;

  @IsOptional()
  @Matches(TIME_RE, { message: 'departure_time must be HH:MM or HH:MM:SS' })
  departure_time?: string;

  @IsOptional()
  @Matches(TIME_RE, { message: 'arrival_time must be HH:MM or HH:MM:SS' })
  arrival_time?: string;
}
