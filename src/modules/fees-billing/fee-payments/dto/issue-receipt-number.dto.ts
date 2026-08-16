import { ArrayMinSize, IsArray, IsDateString, IsInt } from 'class-validator';

// Issued once per "Print Receipt" click, covering every payment selected in
// that click — never per-payment, so printing 3 selected payments together
// produces exactly one receipt number, not three.
export class IssueReceiptNumberDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsInt({ each: true })
  fee_payment_ids: number[];

  // Billing staff can edit this before printing (defaults to today's device
  // date on the frontend) — stored as chosen, never re-derived from
  // payment_date or the server clock.
  @IsDateString()
  print_date: string;
}
