import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { createClient } from '@supabase/supabase-js';
import { StorageProvider, StorageUploadResult } from '../storage-provider';

/**
 * Supabase Storage implementation of StorageProvider. Uses the service_role
 * key — this must only ever run server-side (it bypasses Storage RLS
 * entirely), never expose SUPABASE_SERVICE_KEY to the frontend.
 */
@Injectable()
export class SupabaseStorageProvider extends StorageProvider {
  private readonly client: ReturnType<typeof createClient>;

  constructor() {
    super();
    const url = process.env.SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !serviceKey) {
      throw new InternalServerErrorException(
        'Supabase Storage is not configured — SUPABASE_URL and SUPABASE_SERVICE_KEY must both be set.',
      );
    }

    this.client = createClient(url, serviceKey);
  }

  async upload(
    bucket: string,
    path: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<StorageUploadResult> {
    const { error } = await this.client.storage
      .from(bucket)
      .upload(path, buffer, { contentType, upsert: true });

    if (error) {
      throw new InternalServerErrorException(
        `Storage upload failed: ${error.message}`,
      );
    }

    const { data } = this.client.storage.from(bucket).getPublicUrl(path);
    return { path, url: data.publicUrl };
  }

  async getSignedUrl(
    bucket: string,
    path: string,
    expiresInSeconds: number,
  ): Promise<string> {
    const { data, error } = await this.client.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);

    if (error) {
      throw new InternalServerErrorException(
        `Could not create a signed URL: ${error.message}`,
      );
    }

    return data.signedUrl;
  }

  async delete(bucket: string, path: string): Promise<void> {
    const { error } = await this.client.storage.from(bucket).remove([path]);
    if (error) {
      throw new InternalServerErrorException(
        `Storage delete failed: ${error.message}`,
      );
    }
  }
}
