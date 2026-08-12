import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** POST /me/maintenance/service-log — Transport office only. */
export class CreateServiceLogDto {
  @Type(() => Number)
  @IsInt()
  bus_id!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  work_description!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  garage?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometer_km?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  cost?: number;

  @IsOptional()
  @IsDateString({}, { message: 'service_date must be a valid ISO date' })
  service_date?: string;
}
