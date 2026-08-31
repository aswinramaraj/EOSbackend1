/**
 * Supabase Storage bucket names for the admissions photo/document feature —
 * separate from the single env-configured bucket StorageService defaults to
 * (announcement_attachments), which stays untouched for its existing callers
 * (resumes, announcements, LMS). These two buckets already exist in the
 * Supabase project (confirmed via storage.listBuckets() — note singular
 * "student", not "students"); nothing here creates them.
 *
 * student_photos is PUBLIC — photo_url can be a plain, permanent public URL.
 * student_documents is PRIVATE — file_url must store the storage KEY, not a
 * URL; a signed, time-limited URL has to be generated fresh on every read
 * (see StorageService.getSignedDownloadUrl). This is exactly the distinction
 * the admission form's own reference comment anticipated: "file_url holds
 * the path to the scan (VarChar 500 — a storage key, not the bytes)".
 */
export const STORAGE_BUCKETS = {
  STUDENT_PHOTOS: 'student_photos',
  STUDENT_DOCUMENTS: 'student_documents',
  /** Not yet confirmed to exist in the Supabase project — created on first
   * real upload attempt if StorageService's upload() doesn't auto-create it;
   * see VenuesService.uploadPhoto. */
  VENUE_PHOTOS: 'venue_photos',
} as const;
