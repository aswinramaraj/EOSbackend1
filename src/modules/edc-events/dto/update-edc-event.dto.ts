import { PartialType } from '@nestjs/mapped-types';
import { CreateEdcEventDto } from './create-edc-event.dto';

export class UpdateEdcEventDto extends PartialType(CreateEdcEventDto) {}
