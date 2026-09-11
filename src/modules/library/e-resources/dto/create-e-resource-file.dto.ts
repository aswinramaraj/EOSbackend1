import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  EResourceLicenseType,
  EResourcePublishState,
} from './create-e-resource.dto';

/**
 * POST /library/e-resources/upload (multipart) — everything CreateEResourceDto
 * has except `url`, `format`, `file_size_bytes`, which are derived from the
 * uploaded file itself instead of typed in. Numeric fields need @Type(Number)
 * since multipart form fields always arrive as strings and the global
 * ValidationPipe has implicit conversion disabled.
 */
export class CreateEResourceFileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  category_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pages?: number;

  @IsOptional()
  @IsEnum(EResourceLicenseType)
  license_type?: EResourceLicenseType;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  concurrent_seats?: number;

  @IsOptional()
  @IsEnum(EResourcePublishState)
  publish_state?: EResourcePublishState;
}
