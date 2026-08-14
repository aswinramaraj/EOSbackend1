import { IsIn } from 'class-validator';

// Client vocabulary stays 'approved'/'rejected' - same as DecideOutingDto -
// LeaveRequestsService.decide() translates 'approved' to the specific
// 'warden_approved' student_leave_status_enum value.
export class DecideLeaveRequestDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';
}
