import { IsIn } from 'class-validator';

export class DecideOutingDto {
  @IsIn(['approved', 'rejected'])
  decision: 'approved' | 'rejected';
}
