import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddSignoffDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  member_name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  member_role: string;
}
