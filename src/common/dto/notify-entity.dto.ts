import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Shared body shape for every "POST /:entity/:id/notify" ad-hoc-message
 * endpoint (faculty, students, ...) — one validated title/message pair
 * that gets handed straight to NotificationsService.notify(). Kept here
 * instead of duplicated per module since the shape and validation rules
 * are identical regardless of which entity the notification targets.
 */
export class NotifyEntityDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  message: string;
}
