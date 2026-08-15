import { IsDateString, IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export const BUS_DOC_TYPES = ['insurance', 'fitness_certificate', 'permit', 'pollution_certificate', 'road_tax'] as const;
export type BusDocType = (typeof BUS_DOC_TYPES)[number];

/** POST /me/compliance/documents — Transport office only. Upserts one (bus_id, doc_type) row. */
export class UpsertBusDocumentDto {
  @Type(() => Number)
  @IsInt()
  bus_id!: number;

  @IsIn(BUS_DOC_TYPES)
  doc_type!: BusDocType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference_no?: string;

  @IsDateString({}, { message: 'valid_until must be a valid ISO date' })
  valid_until!: string;
}
