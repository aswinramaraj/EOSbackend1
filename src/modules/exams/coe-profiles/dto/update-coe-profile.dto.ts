import { IsBoolean } from 'class-validator';

export class UpdateCoeProfileDto {
  @IsBoolean({ message: 'is_senior must be a boolean' })
  is_senior: boolean;
}
