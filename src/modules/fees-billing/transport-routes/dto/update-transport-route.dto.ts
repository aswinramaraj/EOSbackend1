import { PartialType } from '@nestjs/mapped-types';
import { CreateTransportRouteDto } from './create-transport-route.dto';

export class UpdateTransportRouteDto extends PartialType(
  CreateTransportRouteDto,
) {}
