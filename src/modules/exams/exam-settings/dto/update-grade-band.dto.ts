import { PartialType } from '@nestjs/mapped-types';
import { CreateGradeBandDto } from './create-grade-band.dto';

export class UpdateGradeBandDto extends PartialType(CreateGradeBandDto) {}
