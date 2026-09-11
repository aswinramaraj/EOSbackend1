import { ArrayMinSize, IsArray, IsInt } from 'class-validator';

export class IssueOdLetterNumbersDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  student_ids: number[];
}
