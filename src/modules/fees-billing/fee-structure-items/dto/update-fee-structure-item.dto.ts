import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateFeeStructureItemDto {
  @IsOptional()
  @IsInt()
  demand_category_id?: number;

  @IsOptional()
  @IsInt()
  hostel_room_type_id?: number;

  @IsOptional()
  @IsInt()
  transport_stage_id?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;
}
