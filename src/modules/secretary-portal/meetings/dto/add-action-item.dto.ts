import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddActionItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  label: string;
}
