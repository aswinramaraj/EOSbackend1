import { IsEnum } from 'class-validator';
import { feedback_course_type_enum } from '../../../../../generated/prisma/enums';

export class GetQuestionTemplatesQueryDto {
  @IsEnum(feedback_course_type_enum)
  category: feedback_course_type_enum;
}
