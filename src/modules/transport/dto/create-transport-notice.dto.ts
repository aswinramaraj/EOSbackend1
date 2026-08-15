import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** POST /me/transport-notices — Transport office only. */
export class CreateTransportNoticeDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  tag!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title!: string;
}
