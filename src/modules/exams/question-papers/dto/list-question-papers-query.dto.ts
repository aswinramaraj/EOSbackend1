import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive, IsString } from 'class-validator';

export class ListQuestionPapersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  department_id?: number;

  @IsOptional()
  @IsIn(['awaiting_upload', 'under_moderation', 'sealed'])
  status?: 'awaiting_upload' | 'under_moderation' | 'sealed';

  @IsOptional()
  @IsString()
  search?: string;
}
