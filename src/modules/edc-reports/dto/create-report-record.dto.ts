import { IsString, MaxLength } from 'class-validator';

/** Logs one row in the "Report Library" (edc_reports) — called right after
 * a real export succeeds, from the same request, not a separate manual step. */
export class CreateReportRecordDto {
  @IsString()
  @MaxLength(200)
  report_name: string;

  @IsString()
  @MaxLength(60)
  period_label: string;
}
