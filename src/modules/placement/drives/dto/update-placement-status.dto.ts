import { IsBoolean, IsOptional } from 'class-validator';

export class UpdatePlacementStatusDto {
  @IsOptional()
  @IsBoolean()
  placement_eligible?: boolean;

  @IsOptional()
  @IsBoolean()
  placement_opted_out?: boolean;
}
