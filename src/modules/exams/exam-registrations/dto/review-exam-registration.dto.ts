import { IsIn } from 'class-validator';

export class ReviewExamRegistrationDto {
  /** 'pending' reopens a previously rejected registration for re-review. */
  @IsIn(['approved', 'rejected', 'pending'])
  status: 'approved' | 'rejected' | 'pending';
}
