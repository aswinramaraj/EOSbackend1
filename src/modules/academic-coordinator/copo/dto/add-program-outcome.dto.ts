import { IsInt, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class AddProgramOutcomeDto {
  @IsInt()
  department_id!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  code!: string;

  @IsString()
  @IsNotEmpty()
  description!: string;
}
