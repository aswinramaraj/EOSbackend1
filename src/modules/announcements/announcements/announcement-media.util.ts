import { Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { Prisma } from '../../../../generated/prisma/client';

/**
 * Photos/videos attached to an announcement, as an ordered carousel.
 *
 * Accessed through $queryRaw rather than the generated Prisma client: the table
 * is created by hand (prisma/migrations/announcement_media.sql) and the client
 * is not regenerated, exactly like the medical-centre module's own tables. That
 * also means every read has to tolerate the table not existing yet, which is
 * what mediaSchemaReady below is for — a post with no carousel must keep
 * working rather than 500.
 */

const logger = new Logger('AnnouncementMedia');

/** Matches announcement_media_seq_range_check in the migration. */
export const MAX_MEDIA_PER_POST = 10;

export type AnnouncementMediaType = 'photo' | 'video';

export interface AnnouncementMediaInput {
  storage_key: string;
  media_type: AnnouncementMediaType;
  thumbnail_key?: string | null;
  width?: number | null;
  height?: number | null;
  duration_seconds?: number | null;
}

export interface AnnouncementMediaItem {
  id: number;
  media_type: AnnouncementMediaType;
  /** Derived from storage_key on every read — never a stored URL, so it cannot go stale. */
  url: string;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  sequence_no: number;
}

interface MediaRow {
  id: number;
  announcement_id: number;
  media_type: AnnouncementMediaType;
  storage_key: string;
  thumbnail_key: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  sequence_no: number;
}

let mediaTablePresent = false;

/**
 * True once announcement_media exists. Only a positive result is cached: the
 * table can be created while the API is already running, so a negative answer
 * has to stay re-checkable without a restart.
 */
export async function mediaSchemaReady(
  prisma: PrismaService,
): Promise<boolean> {
  if (mediaTablePresent) return true;
  const rows = await prisma.$queryRaw<{ ready: boolean }[]>(Prisma.sql`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables WHERE table_name = 'announcement_media'
    ) AS ready
  `);
  mediaTablePresent = rows[0]?.ready === true;
  return mediaTablePresent;
}

/**
 * Writes the carousel for one announcement, inside the caller's transaction so
 * a post can never be visible without the media it was published with.
 *
 * sequence_no is assigned here from array order rather than taken from the
 * client: it is the one thing that must be a contiguous 1..n, and letting a
 * client send it invites gaps and duplicate slide positions (the migration's
 * UNIQUE (announcement_id, sequence_no) would then reject the whole post).
 */
export async function insertAnnouncementMedia(
  tx: Prisma.TransactionClient,
  announcementId: number,
  media: AnnouncementMediaInput[],
): Promise<void> {
  if (media.length === 0) return;

  const values = media.slice(0, MAX_MEDIA_PER_POST).map(
    (item, index) =>
      Prisma.sql`(
      ${announcementId}::int,
      ${item.media_type}::achievement_media_type_enum,
      ${item.storage_key}::varchar,
      ${item.media_type === 'video' ? (item.thumbnail_key ?? null) : null}::varchar,
      ${item.width ?? null}::int,
      ${item.height ?? null}::int,
      ${item.media_type === 'video' ? (item.duration_seconds ?? null) : null}::int,
      ${index + 1}::smallint
    )`,
  );

  await tx.$executeRaw(Prisma.sql`
    INSERT INTO announcement_media
      (announcement_id, media_type, storage_key, thumbnail_key, width, height, duration_seconds, sequence_no)
    VALUES ${Prisma.join(values, ', ')}
  `);
}

/**
 * Loads media for many announcements in ONE query, keyed by announcement id.
 *
 * Batched deliberately: the feed lists dozens of posts, and a per-post query
 * here would turn one list request into N+1 round trips against a pooled
 * connection.
 */
export async function loadAnnouncementMedia(
  prisma: PrismaService,
  storage: StorageService,
  announcementIds: number[],
): Promise<Map<number, AnnouncementMediaItem[]>> {
  const byAnnouncement = new Map<number, AnnouncementMediaItem[]>();
  if (announcementIds.length === 0) return byAnnouncement;

  if (!(await mediaSchemaReady(prisma))) return byAnnouncement;

  let rows: MediaRow[];
  try {
    rows = await prisma.$queryRaw<MediaRow[]>(Prisma.sql`
      SELECT id, announcement_id, media_type::text AS media_type, storage_key,
             thumbnail_key, width, height, duration_seconds,
             sequence_no::int AS sequence_no
      FROM announcement_media
      WHERE announcement_id IN (${Prisma.join(announcementIds)})
      ORDER BY announcement_id, sequence_no
    `);
  } catch (err) {
    // A post is still readable without its carousel; losing the whole feed
    // because media could not be read would be the worse failure.
    logger.error('Failed to load announcement media', err);
    return byAnnouncement;
  }

  for (const row of rows) {
    const list = byAnnouncement.get(row.announcement_id) ?? [];
    list.push({
      id: row.id,
      media_type: row.media_type,
      url: storage.getPublicUrl(row.storage_key),
      thumbnail_url: row.thumbnail_key
        ? storage.getPublicUrl(row.thumbnail_key)
        : null,
      width: row.width,
      height: row.height,
      duration_seconds: row.duration_seconds,
      sequence_no: row.sequence_no,
    });
    byAnnouncement.set(row.announcement_id, list);
  }
  return byAnnouncement;
}

/**
 * Storage keys belonging to an announcement, so its files can be removed from
 * the bucket when the post is deleted. Without this, deleting a post would
 * orphan every uploaded file in storage forever.
 */
export async function announcementMediaKeys(
  prisma: PrismaService,
  announcementId: number,
): Promise<string[]> {
  if (!(await mediaSchemaReady(prisma))) return [];
  try {
    const rows = await prisma.$queryRaw<
      { storage_key: string; thumbnail_key: string | null }[]
    >(Prisma.sql`
      SELECT storage_key, thumbnail_key FROM announcement_media
      WHERE announcement_id = ${announcementId}::int
    `);
    return rows.flatMap((r) =>
      r.thumbnail_key ? [r.storage_key, r.thumbnail_key] : [r.storage_key],
    );
  } catch (err) {
    logger.error(
      `Failed to read media keys for announcement ${announcementId}`,
      err,
    );
    return [];
  }
}
