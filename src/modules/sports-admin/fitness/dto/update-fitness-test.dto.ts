import { PartialType } from '@nestjs/mapped-types';
import { CreateFitnessTestDto } from './create-fitness-test.dto';

export class UpdateFitnessTestDto extends PartialType(CreateFitnessTestDto) {}
