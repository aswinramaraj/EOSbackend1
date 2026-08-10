import { IsBooleanString, IsIn, IsOptional, IsString } from 'class-validator';
import { soa_status_enum } from 'generated/prisma/client';
import { PaginationDto } from 'src/common/dto/pagination.dto';

const VALID_STATUSES = Object.values(soa_status_enum);

/** GET /soa-applications — query filters, layered on the project's shared pagination convention. */
export class ListSoaApplicationsQueryDto extends PaginationDto {
  @IsOptional()
  @IsString()
  q?: string; // searches first_name, last_name, student_email, student_contact, parent_contact

  @IsOptional()
  @IsIn(VALID_STATUSES, {
    message: `status must be one of: ${VALID_STATUSES.join(', ')}`,
  })
  status?: soa_status_enum;

  /**
   * "Draft" isn't a real soa_status_enum value — it's admission_confirmed
   * applications that have started (but not finished) Complete Profile.
   * Takes priority over `status` when present, since the two filters are
   * mutually exclusive views of the pipeline.
   */
  @IsOptional()
  @IsBooleanString()
  has_draft?: string;
}
