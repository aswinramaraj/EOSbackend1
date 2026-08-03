import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateAlumniAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsString()
  @IsNotEmpty()
  content: string;
}
