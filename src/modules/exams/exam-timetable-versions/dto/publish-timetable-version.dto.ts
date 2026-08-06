import { IsBoolean, IsOptional } from 'class-validator';

export class PublishTimetableVersionDto {
  /** Confirms publishing even though another published version has the same paper/date/session signature. */
  @IsOptional()
  @IsBoolean({ message: 'force must be a boolean' })
  force?: boolean;
}
