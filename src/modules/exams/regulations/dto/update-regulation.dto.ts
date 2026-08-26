import { PartialType } from '@nestjs/mapped-types';
import { CreateRegulationDto } from './create-regulation.dto';

export class UpdateRegulationDto extends PartialType(CreateRegulationDto) {}
