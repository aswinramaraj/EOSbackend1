export interface StorageUploadResult {
  /** Provider-internal path/key — store this, not the url, when the bucket is private. */
  path: string;
  /** Permanent public URL. Only meaningful for public buckets — empty string for private ones. */
  url: string;
}

/**
 * Storage is accessed only through this abstract class everywhere in the
 * app — callers depend on `StorageProvider`, never on a concrete provider
 * or its SDK. Swapping providers (e.g. Supabase Storage -> S3/R2) means
 * writing one new class that extends this and changing a single `useClass`
 * binding in storage.module.ts — nothing else in the codebase changes.
 */
export abstract class StorageProvider {
  abstract upload(
    bucket: string,
    path: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<StorageUploadResult>;

  /** For private buckets: a time-limited URL to view/download one object. */
  abstract getSignedUrl(
    bucket: string,
    path: string,
    expiresInSeconds: number,
  ): Promise<string>;

  abstract delete(bucket: string, path: string): Promise<void>;
}
