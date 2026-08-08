import { IsBoolean, IsDateString, IsNumber, IsOptional, Min } from 'class-validator';

export class UpdateFeeConcessionDto {
  @IsNumber()
  @Min(0)
  concession_amount: number;

  @IsOptional()
  @IsBoolean()
  is_settled?: boolean;

  @IsOptional()
  @IsDateString()
  settled_date?: string;
}
