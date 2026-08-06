import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
} from 'class-validator';

export enum SeatingAllocationMode {
  automatic = 'automatic',
  manual = 'manual',
}

export enum SeatingPatternValue {
  sequential = 'sequential',
  alternate_seat = 'alternate_seat',
  rowwise_mixed = 'rowwise_mixed',
  columnwise_mixed = 'columnwise_mixed',
  checkerboard = 'checkerboard',
  snake_order = 'snake_order',
}

export class AddVersionVenueDto {
  @Type(() => Number)
  @IsInt({ message: 'venue_id must be an integer' })
  @IsPositive({ message: 'venue_id must be a positive integer' })
  venue_id: number;

  @IsOptional()
  @IsEnum(SeatingAllocationMode, {
    message: 'allocation_mode must be automatic or manual',
  })
  allocation_mode?: SeatingAllocationMode;

  @IsOptional()
  @IsEnum(SeatingPatternValue, { message: 'Invalid seating pattern' })
  pattern?: SeatingPatternValue;

  /** Empty/omitted = no department restriction. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  department_ids?: number[];
}
