import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddEvidenceItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  label: string;
}
