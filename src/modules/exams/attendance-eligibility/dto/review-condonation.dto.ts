import { IsIn } from 'class-validator';

export class ReviewCondonationDto {
  @IsIn(['approved', 'rejected'])
  status: 'approved' | 'rejected';
}
