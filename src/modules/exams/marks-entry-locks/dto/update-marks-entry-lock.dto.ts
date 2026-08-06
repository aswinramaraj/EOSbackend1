import { IsBoolean } from 'class-validator';

export class UpdateMarksEntryLockDto {
  @IsBoolean({ message: 'is_locked must be a boolean' })
  is_locked: boolean;
}
