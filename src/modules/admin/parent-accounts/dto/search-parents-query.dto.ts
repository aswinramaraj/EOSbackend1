import { IsOptional, IsString } from 'class-validator';

/** GET /parents/search?q= (Admin). Matches by the parent's own email, or by a linked child's name/roll/student id no. */
export class SearchParentsQueryDto {
  @IsOptional()
  @IsString()
  q?: string;
}
