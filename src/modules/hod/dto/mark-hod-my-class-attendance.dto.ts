import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  ValidateNested,
} from 'class-validator';

class HodAttendanceRecordDto {
  @IsInt()
  student_id: number;

  @IsIn(['present', 'absent', 'on_duty'])
  status: 'present' | 'absent' | 'on_duty';
}

export class MarkHodMyClassAttendanceDto {
  @IsInt()
  class_id: number;

  @IsInt()
  subject_id: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HodAttendanceRecordDto)
  records: HodAttendanceRecordDto[];
}
