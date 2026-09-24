import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsPositive,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PaginationDto } from '../../../../common/dto/pagination.dto';
import { DRIVE_STATUSES, type DriveStatus } from './drive-status.constant';

export class ListDrivesQueryDto extends PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  company_id?: number;

  @IsOptional()
  @IsIn(DRIVE_STATUSES)
  status?: DriveStatus;

  /** When true, only returns drives scheduled today or later. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  upcoming?: boolean;

  /** Real once internship_drive_type.query.md runs. Omitted defaults to 'full_time' — Internships get their own dedicated list (GET /drives/internships/report), so this endpoint never mixes the two by accident. */
  @IsOptional()
  @IsIn(['full_time', 'internship'])
  drive_type?: 'full_time' | 'internship';
}
