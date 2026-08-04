import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

export class AddTransportStageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  stage_name: string;

  @IsInt()
  sequence_no: number;

  @IsNumber()
  @Min(0)
  fee_amount: number;
}
