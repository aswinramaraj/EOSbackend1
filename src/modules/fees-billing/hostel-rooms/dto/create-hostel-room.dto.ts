import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateHostelRoomDto {
  @IsInt()
  hostel_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  room_number: string;

  @IsInt()
  room_type_id: number;

  @IsInt()
  @Min(1)
  capacity: number;

  /** Real column (hostel_rooms.block_id), previously write-orphaned — nothing ever set it via the app. Must belong to the same hostel_id as this room. */
  @IsOptional()
  @IsInt()
  block_id?: number;

  /**
   * Real column (hostel_rooms.floor_id, query.md #10). Must belong to the
   * same block as block_id (both this dto's own block_id when given, or the
   * room's existing block on update). Nullable so a PATCH can explicitly
   * clear it back to "no floor" — omitting the field entirely leaves it
   * unchanged instead.
   */
  @IsOptional()
  @IsInt()
  floor_id?: number | null;
}
