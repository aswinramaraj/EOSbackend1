import { IsEnum, IsOptional, IsString } from 'class-validator';

export enum IndentStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  FULFILLED = 'fulfilled',
}

export class UpdateIndentDto {
  @IsEnum(IndentStatus)
  status: IndentStatus;

  @IsOptional()
  @IsString()
  resolution_notes?: string;
}
