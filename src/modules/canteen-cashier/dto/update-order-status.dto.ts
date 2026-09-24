import { IsIn } from 'class-validator';

export class UpdateOrderStatusDto {
  @IsIn(['ready'])
  status: 'ready';
}
