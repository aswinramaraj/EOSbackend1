import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  notification_type_enum,
  coe_broadcast_audience_enum,
} from 'generated/prisma/client';

export class CreateBroadcastDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title!: string;

  @IsEnum(notification_type_enum)
  category!: notification_type_enum;

  @IsEnum(coe_broadcast_audience_enum)
  audience!: coe_broadcast_audience_enum;

  @IsOptional()
  @IsBoolean()
  send_portal?: boolean;

  @IsOptional()
  @IsBoolean()
  send_email?: boolean;

  @IsOptional()
  @IsBoolean()
  send_sms?: boolean;

  @IsString()
  @IsNotEmpty()
  message!: string;

  /** Omit to publish immediately ("Publish now"); provide a future timestamp to schedule ("Schedule"). */
  @IsOptional()
  @IsDateString()
  scheduled_at?: string;
}
