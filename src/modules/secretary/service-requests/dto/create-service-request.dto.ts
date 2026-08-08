import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

/** One line item within a service request's `items` array. */
export class ServiceRequestItemDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  service_name: string;
}

/**
 * POST /me/service-requests (Secretary).
 *
 * Creates a request in 'draft' status. The Secretary Portal's form lets the
 * user add/remove service line items freely before ever submitting, so
 * `items` is accepted as a whole array here (and replaced wholesale on
 * PATCH) rather than exposed as separate per-item endpoints — a line item
 * has no meaning outside its parent request. Use
 * POST /me/service-requests/:id/submit to move a draft to 'pending' once
 * title and at least one item are in place; that's validated there, not
 * here, since a draft is allowed to be incomplete while still being edited.
 * `requested_by_user_id` and `status` are never client-supplied.
 */
export class CreateServiceRequestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  justification?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ServiceRequestItemDto)
  items?: ServiceRequestItemDto[];
}
