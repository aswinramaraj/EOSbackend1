import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ReportMismatchDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  note: string;
}
