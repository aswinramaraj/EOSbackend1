import { IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
