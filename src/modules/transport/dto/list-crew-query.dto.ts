import { IsOptional, IsString } from 'class-validator';

/** GET /me/crew?search= */
export class ListCrewQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
}
