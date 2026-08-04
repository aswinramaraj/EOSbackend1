import { PartialType } from '@nestjs/mapped-types';
import { CreateInvigilationDto } from './create-invigilation.dto';

export class UpdateInvigilationDto extends PartialType(CreateInvigilationDto) {}
