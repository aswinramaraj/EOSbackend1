import { IsDateString, IsEnum, IsInt, IsOptional, Min } from 'class-validator';

export enum BorrowerType {
  student = 'student',
  faculty = 'faculty',
  staff = 'staff',
}

export class CreateBorrowRecordDto {
  @IsInt()
  @Min(1)
  book_id: number;

  @IsEnum(BorrowerType)
  borrower_type: BorrowerType;

  @IsOptional()
  @IsInt()
  @Min(1)
  student_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  faculty_id?: number;

  // Optional — the librarian's Issue page always supplies this explicitly,
  // but a student self-checkout call can omit it entirely; the service
  // defaults it from library_settings.default_borrowing_days.
  @IsOptional()
  @IsDateString()
  due_date?: string;
}
