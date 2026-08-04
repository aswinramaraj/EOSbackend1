import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBatchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @IsInt()
  @Min(1900)
  @Max(2100)
  start_year!: number;

  @IsInt()
  @Min(1900)
  @Max(2100)
  end_year!: number;
}
