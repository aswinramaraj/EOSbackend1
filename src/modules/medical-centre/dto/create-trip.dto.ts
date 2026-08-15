import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateTripDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  case_summary!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  detail?: string;

  @IsIn(['referred', 'returned'])
  outcome!: 'referred' | 'returned';
}
