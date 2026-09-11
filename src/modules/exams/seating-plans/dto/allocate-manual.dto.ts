import { IsArray, IsString } from 'class-validator';
import { TargetVenueDto } from './target-venue.dto';

export class AllocateManualDto extends TargetVenueDto {
  /** Each entry is a single register number or a "START-END" range, e.g. "22IT101-22IT130". */
  @IsArray()
  @IsString({ each: true })
  entries!: string[];
}
