import { IsISO8601, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/** POST /placement/todos */
export class CreateTodoDto {
  @IsString()
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsISO8601()
  deadline?: string;

  /** Set via the standalone PDF upload endpoint first, then passed through here - never a client-supplied arbitrary URL. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  pdfUrl?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(500)
  linkUrl?: string;
}
