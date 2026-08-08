import { Transform, Type } from 'class-transformer';
import { ArrayNotEmpty, IsIn, IsInt, IsISO8601, IsOptional } from 'class-validator';

export const IQAC_REPORT_BUNDLE_TYPES = [
  'venue_bookings',
  'student_ods',
  'faculty_ods',
] as const;
export type IqacReportBundleType = (typeof IQAC_REPORT_BUNDLE_TYPES)[number];

/**
 * GET /iqac/reports/bundle?types=venue_bookings,student_ods&from=&to=&format=
 * (IQAC only). Matches the admin portal's "Build a download" checklist +
 * single download button — one workbook (Excel) or one concatenated
 * document (PDF) covering every selected report type.
 */
export class IqacReportBundleQueryDto {
  @Transform(({ value }) =>
    typeof value === 'string' ? value.split(',').map((v) => v.trim()) : value,
  )
  @ArrayNotEmpty({ message: 'types must include at least one report type' })
  @IsIn(IQAC_REPORT_BUNDLE_TYPES, { each: true })
  types: IqacReportBundleType[];

  @IsIn(['excel', 'pdf'])
  format: 'excel' | 'pdf';

  @IsOptional()
  @IsISO8601({}, { message: 'from must be a valid ISO date' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'to must be a valid ISO date' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  department_id?: number;
}
