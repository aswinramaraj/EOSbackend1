import { IsInt, Min } from 'class-validator';

export class CreateBorrowRequestDto {
  @IsInt()
  @Min(1)
  book_id: number;
}
