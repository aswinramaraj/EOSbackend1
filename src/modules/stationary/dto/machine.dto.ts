import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

const MACHINE_CATEGORIES = ['printer', 'binding'] as const;
const MACHINE_STATUSES = ['working', 'under_repair', 'maintenance'] as const;

export class CreateMachineDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(150)
  model: string;

  @IsOptional()
  @IsIn(MACHINE_CATEGORIES)
  category?: (typeof MACHINE_CATEGORIES)[number];

  @IsOptional()
  @IsIn(MACHINE_STATUSES)
  status?: (typeof MACHINE_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class UpdateMachineDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  model?: string;

  @IsOptional()
  @IsIn(MACHINE_CATEGORIES)
  category?: (typeof MACHINE_CATEGORIES)[number];

  @IsOptional()
  @IsIn(MACHINE_STATUSES)
  status?: (typeof MACHINE_STATUSES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
