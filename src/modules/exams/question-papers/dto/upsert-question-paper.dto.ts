import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';

export class UpsertQuestionPaperDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_subject_mapping_id: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  setter_faculty_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  moderator_faculty_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sets_count?: number;

  @IsOptional()
  @IsIn(['awaiting_upload', 'under_moderation', 'sealed'])
  status?: 'awaiting_upload' | 'under_moderation' | 'sealed';
}
