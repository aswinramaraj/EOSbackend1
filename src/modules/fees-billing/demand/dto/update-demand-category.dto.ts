import { PartialType } from '@nestjs/mapped-types';
import { CreateDemandCategoryDto } from './create-demand-category.dto';

export class UpdateDemandCategoryDto extends PartialType(
  CreateDemandCategoryDto,
) {}
