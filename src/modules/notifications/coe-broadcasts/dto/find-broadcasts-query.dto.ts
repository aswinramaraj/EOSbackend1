import { IsEnum, IsOptional } from 'class-validator';
import {
  notification_type_enum,
  coe_broadcast_status_enum,
} from 'generated/prisma/client';

export class FindBroadcastsQueryDto {
  @IsOptional()
  @IsEnum(notification_type_enum)
  category?: notification_type_enum;

  @IsOptional()
  @IsEnum(coe_broadcast_status_enum)
  status?: coe_broadcast_status_enum;
}
