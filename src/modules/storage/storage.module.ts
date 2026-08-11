import { Module } from '@nestjs/common';
import { StorageProvider } from './storage-provider';
import { SupabaseStorageProvider } from './providers/supabase-storage.provider';
import { StorageService } from './storage.service';

/**
 * Two storage APIs live here, both backed by Supabase Storage, kept side by
 * side rather than merged into one:
 *  - StorageProvider (abstract, multi-bucket, signed-URL capable) — the
 *    newer pattern; faculty-files is its only consumer today. To switch
 *    backends later (e.g. to S3/R2), write a new class implementing
 *    StorageProvider and change the `useClass` line below — every consumer
 *    injects the abstract class and never needs to change.
 *  - StorageService (concrete, single hardcoded bucket) — the older,
 *    simpler pattern still used by appraisal/faculty-od/me-od-attachments.
 * Consolidating these onto one API is a real future cleanup, not something
 * to do silently while resolving an unrelated merge.
 */
@Module({
  providers: [
    { provide: StorageProvider, useClass: SupabaseStorageProvider },
    StorageService,
  ],
  exports: [StorageProvider, StorageService],
})
export class StorageModule {}
