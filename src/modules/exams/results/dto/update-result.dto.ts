// dto/update-result.dto.ts
import { IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateResultDto {
  @IsOptional()
  @IsIn(['original', 'revaluation'], {
    message: 'publication_type must be either original or revaluation',
  })
  publication_type?: 'original' | 'revaluation';

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'published_by_user_id must be an integer' })
  @IsPositive({ message: 'published_by_user_id must be a positive integer' })
  published_by_user_id?: number;
}
