import { PartialType } from '@nestjs/mapped-types';
import { CreateInjuryDto } from './create-injury.dto';

export class UpdateInjuryDto extends PartialType(CreateInjuryDto) {}
