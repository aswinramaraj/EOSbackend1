import { IsBoolean, IsOptional } from 'class-validator';

export class PublishSeatingPlanVersionDto {
  /** Confirms publishing even though another published version has the same venue/depts/pattern signature. */
  @IsOptional()
  @IsBoolean({ message: 'force must be a boolean' })
  force?: boolean;
}
