import { IsEnum, IsOptional } from 'class-validator';
import { feedback_service_type_enum } from '../../../../../generated/prisma/enums';

/** GET /feedback/student/forms?service_type= — omit for the academic list (unchanged); pass a service to get that Campus-tab service's own review form instead. */
export class ListStudentFeedbackFormsQueryDto {
  @IsOptional()
  @IsEnum(feedback_service_type_enum)
  service_type?: feedback_service_type_enum;
}
