import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  ValidateNested,
} from 'class-validator';

export class HodClassAttendanceRecordItemDto {
  @IsInt()
  student_id: number;

  @IsIn(['present', 'absent', 'on_duty'])
  status: 'present' | 'absent' | 'on_duty';
}

/** POST /hod/my-class/attendance/mark (HoD only, own class+subject, today). */
export class MarkHodClassAttendanceDto {
  @IsInt()
  class_id: number;

  @IsInt()
  subject_id: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => HodClassAttendanceRecordItemDto)
  records: HodClassAttendanceRecordItemDto[];
}
