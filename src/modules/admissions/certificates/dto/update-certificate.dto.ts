import { IsBoolean, IsOptional } from 'class-validator';

/**
 * PATCH /certificates/:id — plain JSON, unlike the multipart POST (no file
 * replacement here; re-POST to attach a new scan). Covers the two actions
 * the reference UI keeps distinct from "attach a scan": ticking
 * possession, and a person verifying it against the original.
 */
export class UpdateCertificateDto {
  @IsOptional()
  @IsBoolean()
  is_available?: boolean;

  // true → stamps verified_at = now; false → clears it back to null
  // (un-verifying, e.g. a mistaken verification).
  @IsOptional()
  @IsBoolean()
  verified?: boolean;
}
