import { IsIn } from 'class-validator';

export class ReviewExamRegistrationDto {
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';
}
