import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

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
}
