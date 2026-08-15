import { IsNotEmpty, IsString } from 'class-validator';

export class LookupStudentDto {
  @IsString()
  @IsNotEmpty()
  roll_no: string;
}
