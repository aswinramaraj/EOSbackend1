import { IsOptional, IsString } from 'class-validator';

/** GET /me/routes?search= */
export class ListRoutesQueryDto {
  @IsOptional()
  @IsString()
  search?: string;
}
