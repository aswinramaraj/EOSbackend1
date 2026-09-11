import { IsNotEmpty, IsString } from 'class-validator';

export class LookupStudentQueryDto {
  @IsNotEmpty()
  @IsString()
  register_no!: string;
}
