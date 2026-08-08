import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateBlockDto {
  @IsInt()
  hostel_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsInt()
  @Min(1)
  @Max(50)
  floors: number;
}
