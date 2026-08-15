import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** POST /me/buses — Transport office only. */
export class CreateBusDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  bus_no!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  vehicle_number!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  model?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  year_of_manufacture?: number;

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
  @MaxLength(50)
  fuel_emission?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  capacity?: number;

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
  @IsString()
  @MaxLength(100)
  gps_device_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  parking_bay?: string;

  @IsOptional()
  @IsDateString()
  insurance_valid_till?: string;

  @IsOptional()
  @IsDateString()
  fc_valid_till?: string;

  @IsOptional()
  @IsDateString()
  permit_valid_till?: string;
}
