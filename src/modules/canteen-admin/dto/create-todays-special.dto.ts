import { IsIn } from 'class-validator';

export class CreateTodaysSpecialDto {
  @IsIn(['lunch', 'dinner'])
  meal_type: 'lunch' | 'dinner';
}
