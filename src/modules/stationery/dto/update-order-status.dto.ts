import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export enum UpdatableOrderStatus {
  preparing = 'preparing',
  ready_for_pickup = 'ready_for_pickup',
  collected = 'collected',
  cancelled = 'cancelled',
}

// Deliberately narrower than the full stationery_order_status_enum -
// 'pending' and 'confirmed' are only ever reached by the checkout flow
// itself (payment staged / payment verified), never a manual counter-staff
// action, so they're excluded here.
export class UpdateOrderStatusDto {
  @IsEnum(UpdatableOrderStatus)
  status: UpdatableOrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  cancel_reason?: string;
}
