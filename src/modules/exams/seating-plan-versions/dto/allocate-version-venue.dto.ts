import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
} from 'class-validator';

/**
 * Manual-mode allocation only — automatic mode needs no body, it uses the
 * venue's configured pattern/allowed-departments. Each entry is either a
 * single register number or an inclusive "START-END" range, e.g.
 * ["22IT101-22IT130", "22CS114"].
 */
export class AllocateVersionVenueDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  entries?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  special_accommodation_register_numbers?: string[];
}
