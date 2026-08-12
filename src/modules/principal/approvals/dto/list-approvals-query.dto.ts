import { IsIn, IsOptional, IsString } from 'class-validator';

export const APPROVAL_STATUS_FILTERS = [
  'pending',
  'approved',
  'rejected',
  'all',
] as const;
export type ApprovalStatusFilter = (typeof APPROVAL_STATUS_FILTERS)[number];

export const APPROVAL_KIND_FILTERS = ['leave', 'od', 'all'] as const;
export type ApprovalKindFilter = (typeof APPROVAL_KIND_FILTERS)[number];

export class ListApprovalsQueryDto {
  @IsOptional()
  @IsIn(APPROVAL_STATUS_FILTERS)
  status?: ApprovalStatusFilter;

  @IsOptional()
  @IsIn(APPROVAL_KIND_FILTERS)
  kind?: ApprovalKindFilter;

  @IsOptional()
  @IsString()
  q?: string;
}
