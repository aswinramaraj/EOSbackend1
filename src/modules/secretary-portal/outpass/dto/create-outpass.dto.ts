import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateOutpassDto {
  @Type(() => Number)
  @IsInt()
  student_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  kind: string;

  @IsDateString()
  outpass_date: string;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'from_time must be HH:mm' })
  from_time: string;

  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, { message: 'to_time must be HH:mm' })
  to_time: string;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  parent_contact?: string;
}
