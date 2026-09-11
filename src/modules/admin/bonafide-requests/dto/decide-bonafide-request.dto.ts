import { IsIn } from 'class-validator';

/** PATCH /admin/bonafide-requests/:id/decision */
export class DecideBonafideRequestDto {
  @IsIn(['approve', 'reject'], {
    message: 'decision must be either approve or reject',
  })
  decision!: 'approve' | 'reject';
}
