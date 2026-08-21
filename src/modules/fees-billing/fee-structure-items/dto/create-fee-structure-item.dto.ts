import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

// Exactly one of these three must be set, matching the parent fee
// structure's applies_to — validated in FeeStructureItemService, same rule
// as POST /fee-structures.
export class CreateFeeStructureItemDto {
  @IsOptional()
  @IsInt()
  demand_category_id?: number;

  @IsOptional()
  @IsInt()
  hostel_room_type_id?: number;

  @IsOptional()
  @IsInt()
  transport_stage_id?: number;

  @IsNumber()
  @Min(0)
  amount: number;
}
