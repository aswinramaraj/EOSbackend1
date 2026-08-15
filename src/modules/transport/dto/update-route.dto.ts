import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString, Matches, Min, MaxLength } from 'class-validator';

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

/** PATCH /me/routes/:id — Transport office only. */
export class UpdateRouteDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  boarding_area?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  distance_km?: number;

  @IsOptional()
  @Matches(TIME_RE, { message: 'departure_time must be HH:MM or HH:MM:SS' })
  departure_time?: string;

  @IsOptional()
  @Matches(TIME_RE, { message: 'arrival_time must be HH:MM or HH:MM:SS' })
  arrival_time?: string;
}
