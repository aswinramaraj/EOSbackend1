import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString } from 'class-validator';

/**
 * Shared by every Principal-only institution-wide directory that gained a
 * Batch/Department/Class-with-Section filter row + name-or-roll-no search
 * box (Higher Education, Entrepreneur - see StudentHigherEducationService.
 * findAll/StudentEntrepreneurshipService.findAll). Every field is optional
 * and combinable; omitting all of them keeps the original "every department
 * at once" behavior these endpoints always had.
 */
export class InstitutionDirectoryQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  batch_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  department_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  class_id?: number;
}
