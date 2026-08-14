import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { notification_type_enum } from '../../../../../generated/prisma/enums';

// The full list of producers this powers (leave/OD/appraisal/bonafide/
// revaluation/media-request approvals, LMS tasks, announcements, exam
// results, hall tickets, fees, wallet, attendance, library, placements,
// hostel) is tracked outside this file - see the notifications feature
// plan. `type`/`related_entity_type`/`related_entity_id` are all optional
// because the one producer that existed before this feature (library
// overdue reminders, see BorrowRecordsService) never sets them and keeps
// working exactly as before - a notification with no type just gets a
// generic icon and no deep link on the mobile side.
export class CreateNotificationDto {
  @IsInt()
  @Min(1)
  user_id: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsString()
  @IsNotEmpty()
  message: string;

  @IsOptional()
  @IsIn(Object.values(notification_type_enum))
  type?: notification_type_enum;

  /**
   * A short tag identifying which kind of record this notification is
   * about (e.g. 'faculty_leave', 'od_request', 'lms_task') - deliberately
   * a free-form string, not an enum or a real FK, since it points at
   * whichever one of many different tables produced this notification and
   * Postgres can't FK-constrain across multiple target tables. The mobile
   * client owns a small (type, related_entity_type) -> route mapping for
   * deep-linking; the backend never needs to know what that route is.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  related_entity_type?: string;

  @IsOptional()
  @IsInt()
  related_entity_id?: number;
}
