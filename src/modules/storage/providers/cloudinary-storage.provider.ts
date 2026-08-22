import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'node:stream';
import { StorageProvider, StorageUploadResult } from '../storage-provider';

/**
 * Cloudinary implementation of StorageProvider — used ONLY by
 * AttendanceCvModule (provided directly there, not bound to the shared
 * StorageProvider token in storage.module.ts). Every other consumer of
 * StorageProvider (appraisal, faculty-files) keeps using
 * SupabaseStorageProvider, unaffected — this class exists specifically
 * because attendance evidence photos benefit from Cloudinary's image
 * pipeline (thumbnails/transforms), not as a wholesale storage swap.
 *
 * `bucket` (the abstract method's first argument) maps to a Cloudinary
 * folder rather than a literal bucket — Cloudinary has no bucket concept,
 * folders are the closest equivalent and keep the call signature identical
 * to SupabaseStorageProvider's.
 */
@Injectable()
export class CloudinaryStorageProvider extends StorageProvider {
  private configured = false;

  /**
   * Deliberately not validated in the constructor: Nest instantiates every
   * provider in a module at boot regardless of whether its routes are ever
   * hit, so throwing here would crash the entire app over one unconfigured,
   * narrowly-scoped feature. Validating lazily means the app boots fine and
   * only an actual attendance-evidence-photo upload fails until Cloudinary
   * env vars are set.
   */
  private ensureConfigured(): void {
    if (this.configured) return;

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;

    if (!cloudName || !apiKey || !apiSecret) {
      throw new InternalServerErrorException(
        'Cloudinary is not configured — CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET must all be set.',
      );
    }

    cloudinary.config({ cloud_name: cloudName, api_key: apiKey, api_secret: apiSecret, secure: true });
    this.configured = true;
  }

  async upload(bucket: string, path: string, buffer: Buffer, contentType: string): Promise<StorageUploadResult> {
    this.ensureConfigured();
    // `path` already includes an extension (e.g. "…/session-42.jpg"); Cloudinary's
    // public_id should not repeat it — resource_type stores the file format
    // separately, and duplicating it would produce "session-42.jpg.jpg" URLs.
    const publicId = path.replace(/\.[^./]+$/, '');
    const resourceType = contentType.startsWith('video/') ? 'video' : 'image';

    const result = await new Promise<{ public_id: string; secure_url: string }>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        { folder: bucket, public_id: publicId, resource_type: resourceType, overwrite: true },
        (error, uploadResult) => {
          if (error || !uploadResult) return reject(error ?? new Error('Cloudinary upload returned no result'));
          resolve(uploadResult);
        },
      );
      Readable.from(buffer).pipe(uploadStream);
    }).catch((error: unknown) => {
      throw new InternalServerErrorException(
        `Cloudinary upload failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

    return { path: result.public_id, url: result.secure_url };
  }

  /** Cloudinary URLs on a public cloud are already permanent — there is no separate "sign" step to do. */
  async getSignedUrl(_bucket: string, path: string, _expiresInSeconds: number): Promise<string> {
    this.ensureConfigured();
    return cloudinary.url(path, { secure: true });
  }

  async delete(_bucket: string, path: string): Promise<void> {
    this.ensureConfigured();
    await cloudinary.uploader.destroy(path).catch((error: unknown) => {
      throw new InternalServerErrorException(
        `Cloudinary delete failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }
}
