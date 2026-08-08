import { PartialType } from '@nestjs/mapped-types';
import { CreateServiceRequestDto } from './create-service-request.dto';

/**
 * PATCH /me/service-requests/:id (Secretary, own request, only while 'draft').
 * Whatever fields are supplied are updated; `items`, if supplied, replaces
 * the entire line-item list (see CreateServiceRequestDto for why).
 */
export class UpdateServiceRequestDto extends PartialType(
  CreateServiceRequestDto,
) {}
