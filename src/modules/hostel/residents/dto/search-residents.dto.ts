import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SearchResidentsDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  hostel_id?: number;

  /**
   * Scopes to one specific room — e.g. the Rooms & Allotment page's "who's
   * in this room" roster. Without this, a caller wanting one room's
   * occupants had no choice but to fetch page_size=100 of the whole hostel
   * and filter client-side, which silently dropped anyone sorted past
   * position 100 (a hostel commonly has 300+ residents).
   */
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  room_id?: number;

  /**
   * Was previously accepted by callers (e.g. the admin student-profile
   * "Hostel" panel) but silently stripped by validation and ignored —
   * `data[0]` of an unfiltered page ended up being shown as "the" resident
   * for every hosteller, regardless of which student was actually asked for.
   */
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  student_id?: number;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(100)
  page_size?: number = 20;
}
