import { IsBooleanString, IsOptional } from 'class-validator';
import { PaginationDto } from 'src/common/dto/pagination.dto';

export class ListMyNotificationsQueryDto extends PaginationDto {
  @IsOptional()
  @IsBooleanString()
  unread?: string;
}
