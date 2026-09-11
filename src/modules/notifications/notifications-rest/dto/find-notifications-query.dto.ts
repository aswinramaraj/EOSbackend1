import { IsBooleanString, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

export class FindNotificationsQueryDto extends PaginationDto {
  @IsOptional()
  @IsBooleanString()
  is_read?: string;
}
