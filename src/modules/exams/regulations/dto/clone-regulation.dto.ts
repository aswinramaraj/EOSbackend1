import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CloneRegulationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  new_code: string;
}
