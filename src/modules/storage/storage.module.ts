import { Module } from '@nestjs/common';
import { StorageProvider } from './storage-provider';
import { SupabaseStorageProvider } from './providers/supabase-storage.provider';
import { StorageService } from './storage.service';

/**
 * Two storage abstractions coexist here, each with real consumers:
 *  - StorageProvider (abstract, multi-bucket, signed URLs) - used by
 *    faculty-files. To switch backends later (e.g. to AWS S3 or Cloudflare
 *    R2), write a new class implementing StorageProvider and change the
 *    `useClass` line below.
 *  - StorageService (fixed single bucket, upload/remove) - used by lms,
 *    profile, appraisal, announcements.
 * Neither replaces the other; both are exported so each consumer keeps
 * injecting whichever one it already depends on.
 */
@Module({
  providers: [
    { provide: StorageProvider, useClass: SupabaseStorageProvider },
    StorageService,
  ],
  exports: [StorageProvider, StorageService],
})
export class StorageModule {}
