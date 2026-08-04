import { PartialType } from '@nestjs/mapped-types';
import { CreateHallPlanDto } from './create-hall-plan.dto';

export class UpdateHallPlanDto extends PartialType(CreateHallPlanDto) {}
