import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

export class UpdateTransportStageDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  stage_name?: string;

  @IsOptional()
  @IsInt()
  sequence_no?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  fee_amount?: number;
}
