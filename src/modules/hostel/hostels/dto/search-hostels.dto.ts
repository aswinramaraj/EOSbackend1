import { IsEnum, IsOptional, IsString } from 'class-validator';
import { HostelWing } from './create-hostel.dto';

export class SearchHostelsDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsEnum(HostelWing)
  wing?: HostelWing;
}
