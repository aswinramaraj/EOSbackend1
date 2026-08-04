import { AcademicCalendarEventType } from '../dto/create-academic-calendar-event.dto';

export class AcademicCalendarEvent {
  id!: number;
  academic_calendar_id!: number;
  title!: string;
  description?: string | null;
  event_date!: Date;
  event_type!: AcademicCalendarEventType;
  start_time?: Date | null;
  end_time?: Date | null;
  created_by_user_id?: number | null;
}
