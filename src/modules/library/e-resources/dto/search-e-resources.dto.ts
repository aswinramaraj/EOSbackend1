import { Transform } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  EResourceFormat,
  EResourcePublishState,
} from './create-e-resource.dto';

export class SearchEResourcesDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  category_id?: number;

  @IsOptional()
  @IsEnum(EResourceFormat)
  format?: EResourceFormat;

  @IsOptional()
  @IsEnum(EResourcePublishState)
  publish_state?: EResourcePublishState;

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
