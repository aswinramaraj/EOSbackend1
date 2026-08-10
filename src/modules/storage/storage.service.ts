import 'dotenv/config';
import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface UploadedFileResult {
  url: string;
  path: string;
}

/**
 * Thin wrapper over Supabase Storage. Only two operations are needed today
 * (upload, remove) - if this ever moves to a different provider (S3, GCS,
 * etc.), swap this class's implementation and keep the same method
 * signatures so callers (e.g. AppraisalService) don't need to change.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: SupabaseClient;
  private readonly bucket: string;
  private bucketEnsured = false;

  constructor() {
    const url = process.env.SUPABASE_URL!;
    const serviceKey = process.env.SUPABASE_SERVICE_KEY!;
    this.bucket = process.env.SUPABASE_STORAGE_BUCKET || 'appraisal-attachments';
    this.client = createClient(url, serviceKey);
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketEnsured) return;

    const { data: existing } = await this.client.storage.getBucket(this.bucket);
    if (!existing) {
      const { error } = await this.client.storage.createBucket(this.bucket, {
        public: true,
      });
      if (error && !error.message?.includes('already exists')) {
        this.logger.error(`Failed to create storage bucket ${this.bucket}`, error);
        throw new InternalServerErrorException({
          message: 'Something went wrong. Please try again.',
          errorCode: 'INTERNAL_ERROR',
        });
      }
    }
    this.bucketEnsured = true;
  }

  async upload(buffer: Buffer, path: string, contentType?: string): Promise<UploadedFileResult> {
    await this.ensureBucket();

    const { error } = await this.client.storage
      .from(this.bucket)
      .upload(path, buffer, { contentType, upsert: false });

    if (error) {
      this.logger.error(`Failed to upload ${path} to bucket ${this.bucket}`, error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    const { data } = this.client.storage.from(this.bucket).getPublicUrl(path);
    return { url: data.publicUrl, path };
  }

  async remove(path: string): Promise<void> {
    const { error } = await this.client.storage.from(this.bucket).remove([path]);
    if (error) {
      this.logger.error(`Failed to remove ${path} from bucket ${this.bucket}`, error);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
