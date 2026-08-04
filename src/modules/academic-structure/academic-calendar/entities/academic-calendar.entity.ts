export class AcademicCalendar {
  id!: number;
  batch_id!: number;
  semester!: number;
  start_date!: Date;
  end_date!: Date;
  created_by_user_id?: number | null;
}
