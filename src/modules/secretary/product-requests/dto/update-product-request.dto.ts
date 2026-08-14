import { PartialType } from '@nestjs/mapped-types';
import { CreateProductRequestDto } from './create-product-request.dto';

/**
 * PATCH /me/product-requests/:id (Secretary, own request, only while 'draft').
 * Whatever fields are supplied are updated; `items`, if supplied, replaces
 * the entire line-item list (see CreateProductRequestDto for why).
 */
export class UpdateProductRequestDto extends PartialType(
  CreateProductRequestDto,
) {}
