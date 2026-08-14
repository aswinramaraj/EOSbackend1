import { Module } from '@nestjs/common';
import { StorageProvider } from './storage-provider';
import { SupabaseStorageProvider } from './providers/supabase-storage.provider';
import { StorageService } from './storage.service';

/**
 * Two storage abstractions coexist in *this* module (src/modules/storage),
 * distinct from the separate, generic Supabase-S3 StorageService at
 * src/common/storage — see that file's own comment. Both are exported so
 * each consumer keeps injecting whichever one it already depends on:
 *  - StorageProvider (abstract, multi-bucket, signed-URL capable) — used by
 *    faculty-files. To switch backends later (e.g. to S3/R2), write a new
 *    class implementing StorageProvider and change the `useClass` line
 *    below — every consumer injects the abstract class and never needs to
 *    change.
 *  - StorageService (concrete, single hardcoded bucket) — the older,
 *    simpler pattern still used by appraisal/faculty-od/me-od-attachments.
 * Consolidating these (and the separate common/storage service) onto one
 * API is a real future cleanup, not something to do silently while
 * resolving an unrelated merge.
 */
@Module({
  providers: [
    { provide: StorageProvider, useClass: SupabaseStorageProvider },
    StorageService,
  ],
  exports: [StorageProvider, StorageService],
})
export class StorageModule {}
