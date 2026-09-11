import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class NotifySpecialAdmissionDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;
}
