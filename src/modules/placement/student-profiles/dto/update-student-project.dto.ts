import { PartialType } from '@nestjs/mapped-types';
import { CreateStudentProjectDto } from './create-student-project.dto';

export class UpdateStudentProjectDto extends PartialType(
  CreateStudentProjectDto,
) {}
