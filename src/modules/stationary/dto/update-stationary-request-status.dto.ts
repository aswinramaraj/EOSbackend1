import { IsIn, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

// Only the statuses a VENDOR may ever set directly - pending_payment/paid
// are lifecycle states the student-payment flow (StationaryService.
// createOrder/verifyPayment) owns exclusively; a vendor never creates or
// pays for a request, only moves an already-paid one forward.
const VENDOR_SETTABLE_STATUSES = ['processing', 'ready_for_pickup', 'completed', 'rejected'] as const;

/** PATCH /stationary-requests/:id/status (Stationary vendor / Admin). */
export class UpdateStationaryRequestStatusDto {
  @IsIn(VENDOR_SETTABLE_STATUSES)
  status: (typeof VENDOR_SETTABLE_STATUSES)[number];

  @ValidateIf((o) => o.status === 'rejected')
  @IsString()
  @MaxLength(300)
  rejection_reason?: string;
}
