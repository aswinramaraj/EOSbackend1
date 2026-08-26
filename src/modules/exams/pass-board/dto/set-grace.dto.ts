import { Type } from 'class-transformer';
import { IsInt, IsNumber, IsOptional, IsPositive, IsString, Max, MaxLength, Min } from 'class-validator';

// Grace marks ceiling per the R-2023 regulation shown in the design — at
// most 3 marks can be graced onto any single course on the sheet.
export const GRACE_MARKS_CEILING = 3;

export class SetGraceDto {
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  exam_subject_mapping_id: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(GRACE_MARKS_CEILING)
  grace_marks: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  board_note?: string;
}
