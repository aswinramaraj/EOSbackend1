import { PartialType } from '@nestjs/mapped-types';
import { CreateHostelWardenDto } from './create-hostel-warden.dto';

/**
 * Unlike most other "parent id" fields in this codebase, block_id IS
 * updatable here — wardens genuinely get transferred between blocks, and
 * forcing a delete + re-create for that would lose no real history (there
 * isn't any to lose) while being needlessly annoying (re-typing emp_id/name
 * every transfer).
 */
export class UpdateHostelWardenDto extends PartialType(CreateHostelWardenDto) {}
