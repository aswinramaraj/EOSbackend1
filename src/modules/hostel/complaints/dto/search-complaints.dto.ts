import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { HostelComplaintCategory } from './create-complaint.dto';
import { HostelComplaintStatus } from './update-complaint.dto';

export class SearchComplaintsDto {
  @IsOptional()
  @IsEnum(HostelComplaintStatus)
  status?: HostelComplaintStatus;

  @IsOptional()
  @IsEnum(HostelComplaintCategory)
  category?: HostelComplaintCategory;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  hostel_id?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number = 20;
}
