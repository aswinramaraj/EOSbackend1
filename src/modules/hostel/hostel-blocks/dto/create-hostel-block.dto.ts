import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateHostelBlockDto {
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
