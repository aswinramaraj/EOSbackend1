import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** PATCH /me/buses/:id — Transport office only. Every field optional; only provided fields are written. */
export class UpdateBusDto {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  bus_no?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  vehicle_number?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  route_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  driver_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  gps_device_id?: string;

  @IsOptional()
  @IsIn(['on_route', 'at_campus', 'in_depot', 'maintenance'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  driver_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  driver_licence_no?: string;

  @IsOptional()
  @IsDateString()
  driver_licence_expiry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  attendant_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  attendant_phone?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  odometer_km?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  next_service_due_km?: number;

  @IsOptional()
  @IsDateString()
  last_service_date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  body_type?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year_of_manufacture?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  fuel_emission?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  chassis_no?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  engine_no?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  engine_spec?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  wheelbase_mm?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  tyre_spec?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fuel_tank_litres?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  ownership?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  rto?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  parking_bay?: string;

  @IsOptional()
  @IsDateString()
  registered_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  driver_experience_years?: number;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  driver_blood_group?: string;
}
