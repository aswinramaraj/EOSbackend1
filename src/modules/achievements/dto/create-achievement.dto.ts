import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AchievementMediaItemDto } from './achievement-media-item.dto';

export class CreateAchievementDto {
  @IsInt()
  @IsPositive()
  department_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  achievement_date?: string;

  /** At least one photo/video is required — this is the whole point of the post. */
  @ValidateNested({ each: true })
  @Type(() => AchievementMediaItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  media: AchievementMediaItemDto[];
}
