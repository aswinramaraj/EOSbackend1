import { Module } from '@nestjs/common';
import { StorageProvider } from './storage-provider';
import { SupabaseStorageProvider } from './providers/supabase-storage.provider';

/**
 * To switch storage backends later (e.g. to AWS S3 or Cloudflare R2), write
 * a new class implementing StorageProvider and change the `useClass` line
 * below — every consumer injects the abstract `StorageProvider` and never
 * needs to change.
 */
@Module({
  providers: [{ provide: StorageProvider, useClass: SupabaseStorageProvider }],
  exports: [StorageProvider],
})
export class StorageModule {}
