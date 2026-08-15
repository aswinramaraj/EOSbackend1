import { Type } from 'class-transformer';
import { IsNotEmpty, IsNumber, IsOptional, IsString, Matches, Min, MaxLength } from 'class-validator';

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/;

/** POST /me/routes/:id/stages — Transport office only. sequence_no is auto-assigned (max existing + 1). */
export class CreateStageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  stage_name!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  fee_amount!: number;

  @IsOptional()
  @Matches(TIME_RE, { message: 'pickup_time must be HH:MM or HH:MM:SS' })
  pickup_time?: string;
}
