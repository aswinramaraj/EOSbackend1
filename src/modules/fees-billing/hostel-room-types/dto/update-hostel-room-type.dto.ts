import { PartialType } from '@nestjs/mapped-types';
import { CreateHostelRoomTypeDto } from './create-hostel-room-type.dto';

export class UpdateHostelRoomTypeDto extends PartialType(
  CreateHostelRoomTypeDto,
) {}
