import { IsInt, IsNumber, IsOptional, Min } from 'class-validator';

// Exactly one of demand_category_id / hostel_room_type_id / transport_stage_id
// must be set per item — enforced in FeeStructureService (and mirrored by a DB
// CHECK constraint on fee_structure_items). Which one is expected depends on
// the parent fee structure's applies_to (quota -> demand category, hostel ->
// hostel room type, transport -> transport stage).
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

  @IsOptional()
  @IsNumber()
  @Min(0)
  concession_amount?: number;
}
