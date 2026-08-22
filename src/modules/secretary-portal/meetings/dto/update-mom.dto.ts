import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateMomDto {
  @IsString()
  @IsNotEmpty()
  mom_text: string;
}
