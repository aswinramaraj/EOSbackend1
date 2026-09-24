import { IsInt } from 'class-validator';

export class RequestLibraryBookDto {
  @IsInt()
  book_id: number;
}
