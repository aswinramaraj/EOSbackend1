import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

// Talks to Supabase Storage over its S3-compatible API (see
// SUPABASE_S3_* env vars — Project Settings → Storage → S3 Connection).
// The bucket is PUBLIC, so a stored key resolves to a stable public URL
// (getPublicUrl) — no signing, no expiry. getSignedDownloadUrl is kept
// around for if a future bucket ever needs to be private instead. This
// service is deliberately generic (folder + originalName in, key out) so
// any future feature needing file storage reuses it, not just announcements.
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly supabaseUrl: string;

  constructor() {
    const endpoint = process.env.SUPABASE_S3_ENDPOINT;
    const region = process.env.SUPABASE_S3_REGION;
    const accessKeyId = process.env.SUPABASE_S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.SUPABASE_S3_SECRET_ACCESS_KEY;
    const bucket = process.env.SUPABASE_S3_BUCKET;
    const supabaseUrl = process.env.SUPABASE_URL;

    if (
      !endpoint ||
      !region ||
      !accessKeyId ||
      !secretAccessKey ||
      !bucket ||
      !supabaseUrl
    ) {
      throw new Error(
        'Missing SUPABASE_* env vars (SUPABASE_URL, SUPABASE_S3_ENDPOINT/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY/BUCKET) — storage features are unavailable until these are set.',
      );
    }

    this.bucket = bucket;
    this.supabaseUrl = supabaseUrl.replace(/\/+$/, '');
    this.client = new S3Client({
      endpoint,
      region,
      forcePathStyle: true, // required for Supabase's S3-compatible endpoint
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  /**
   * Stable public URL for a stored key — the bucket is public, so this is
   * a plain URL construction, not a signed/expiring one. `bucket` defaults
   * to the env-configured one (announcement_attachments today) so every
   * existing caller (resumes, announcements, LMS) is unaffected; pass an
   * explicit bucket name (e.g. "students_photos") to target a different
   * bucket without needing a whole second StorageService instance.
   */
  getPublicUrl(key: string, bucket: string = this.bucket): string {
    return `${this.supabaseUrl}/storage/v1/object/public/${bucket}/${key}`;
  }

  /**
   * Uploads a buffer under `folder/` and returns the storage key — pass it
   * to getPublicUrl() to get the actual URL. The key embeds a random UUID
   * so two uploads with the same original filename never collide.
   */
  async upload(
    folder: string,
    originalName: string,
    buffer: Buffer,
    contentType: string,
    bucket: string = this.bucket,
  ): Promise<{ key: string }> {
    const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `${folder}/${randomUUID()}-${safeName}`;

    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );
      return { key };
    } catch (err) {
      this.logger.error(
        `Failed to upload object key=${key} to bucket=${bucket}`,
        err,
      );
      throw new InternalServerErrorException({
        message:
          'Something went wrong while uploading the file. Please try again.',
        errorCode: 'STORAGE_UPLOAD_FAILED',
      });
    }
  }

  /** Fresh signed GET URL for a stored key — expires after SIGNED_URL_TTL_SECONDS. */
  async getSignedDownloadUrl(
    key: string,
    bucket: string = this.bucket,
  ): Promise<string> {
    try {
      return await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: SIGNED_URL_TTL_SECONDS },
      );
    } catch (err) {
      this.logger.error(`Failed to sign download URL for key=${key}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'STORAGE_SIGN_FAILED',
      });
    }
  }

  async delete(key: string, bucket: string = this.bucket): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
      );
    } catch (err) {
      this.logger.error(
        `Failed to delete object key=${key} from bucket=${bucket}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'STORAGE_DELETE_FAILED',
      });
    }
  }
}
