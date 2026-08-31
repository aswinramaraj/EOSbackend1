import { IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateHostelFloorDto {
  @IsInt()
  block_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name: string;
}
