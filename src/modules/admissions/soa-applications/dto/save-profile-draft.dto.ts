import { IsArray, IsObject, IsString } from 'class-validator';

/**
 * PUT /soa-applications/:id/draft — the Complete Profile wizard's in-progress
 * state. `values` is the wizard's flat "category.field" -> string map,
 * `marks` the identity-marks repeat rows, `saved_categories` which category
 * ids the admin has explicitly clicked "Save & continue" on. All three are
 * opaque to the backend — it only stores and returns them verbatim so a
 * half-finished profile survives a closed tab, a refresh, or someone else
 * picking up where the last admin left off.
 */
export class SaveProfileDraftDto {
  @IsObject()
  values: Record<string, string>;

  @IsArray()
  @IsString({ each: true })
  marks: string[];

  @IsArray()
  @IsString({ each: true })
  saved_categories: string[];
}
