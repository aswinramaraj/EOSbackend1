import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';

/** POST /online-classes/start */
export class StartOnlineClassDto {
  @Type(() => Number)
  @IsInt()
  subject_id: number;

  @Type(() => Number)
  @IsInt()
  class_id: number;
}
