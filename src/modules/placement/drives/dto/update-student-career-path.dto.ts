import { IsIn } from 'class-validator';
import {
  CAREER_PATH_VALUES,
  type CareerPath,
} from '../../../admissions/students/me-profile/dto/update-career-path.dto';

export class UpdateStudentCareerPathDto {
  @IsIn(CAREER_PATH_VALUES)
  career_path: CareerPath;
}
