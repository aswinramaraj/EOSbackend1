-- ============================================================================
--  PURGE: all social / Explore-feed post data  (DESTRUCTIVE - READ FIRST)
-- ============================================================================
--  Requested deliberately: the existing posts are demo/test content and the
--  feed is to start empty so real posts can be created by hand.
--
--  THIS DELETES REAL ROWS. It cannot be undone without a backup. Take a
--  Supabase snapshot before running it.
--
--  Scope - what this DOES delete:
--    * every announcement published as a SOCIAL post (i.e. one that has a
--      social_post_details row), plus that row, its class/role targeting, its
--      comments, and any notifications that pointed at it
--    * every achievement post and its media + comments (the other half of the
--      mobile Explore feed)
--
--  Scope - what this does NOT touch:
--    * ordinary announcements/notices that were never social posts (faculty,
--      HoD, principal, COE announcements) - those are real operational
--      records, not feed content. Section 1 is deliberately keyed on
--      social_post_details, not on posted_by role.
--    * users, students, faculty, classes, or anything outside the feed.
--
--  Run section 0 FIRST on its own and read the counts. If a number is bigger
--  than you expect, stop.
-- ============================================================================


-- ── 0. DRY RUN - counts only, deletes nothing. Run this first. ──────────────
SELECT 'social announcements'      AS what, COUNT(*)::int AS rows FROM social_post_details
UNION ALL SELECT 'their comments',  COUNT(*)::int FROM announcement_comments c
          WHERE EXISTS (SELECT 1 FROM social_post_details s WHERE s.announcement_id = c.announcement_id)
UNION ALL SELECT 'their class targeting', COUNT(*)::int FROM announcement_class_mapping m
          WHERE EXISTS (SELECT 1 FROM social_post_details s WHERE s.announcement_id = m.announcement_id)
UNION ALL SELECT 'their role targeting',  COUNT(*)::int FROM announcement_role_mapping m
          WHERE EXISTS (SELECT 1 FROM social_post_details s WHERE s.announcement_id = m.announcement_id)
UNION ALL SELECT 'achievement posts',     COUNT(*)::int FROM department_achievements
UNION ALL SELECT 'achievement media',     COUNT(*)::int FROM achievement_media
UNION ALL SELECT 'achievement comments',  COUNT(*)::int FROM achievement_comments
UNION ALL SELECT 'NON-social announcements (KEPT)', COUNT(*)::int FROM announcements a
          WHERE NOT EXISTS (SELECT 1 FROM social_post_details s WHERE s.announcement_id = a.id);


-- ── 1. Delete social posts ──────────────────────────────────────────────────
--  Children first, then the parent. social_post_details is ON DELETE CASCADE
--  from announcements, but the mappings and comments are not, so they are
--  removed explicitly rather than relying on a cascade that may not exist.

BEGIN;

CREATE TEMP TABLE _social_ids ON COMMIT DROP AS
  SELECT announcement_id AS id FROM social_post_details;

DELETE FROM announcement_comments
 WHERE announcement_id IN (SELECT id FROM _social_ids);

DELETE FROM announcement_class_mapping
 WHERE announcement_id IN (SELECT id FROM _social_ids);

DELETE FROM announcement_role_mapping
 WHERE announcement_id IN (SELECT id FROM _social_ids);

-- Bell/push rows deep-linking to a post that will no longer exist. related_entity_id
-- is a loose pointer (no FK), so nothing else cleans these up.
DELETE FROM notifications
 WHERE related_entity_type = 'announcement'
   AND related_entity_id IN (SELECT id FROM _social_ids);

DELETE FROM social_post_details
 WHERE announcement_id IN (SELECT id FROM _social_ids);

DELETE FROM announcements
 WHERE id IN (SELECT id FROM _social_ids);

COMMIT;


-- ── 2. Delete achievement posts (the other half of the feed) ────────────────
--  Skip this section entirely if you want to keep achievements.

BEGIN;

DELETE FROM achievement_comments;
DELETE FROM achievement_media;

DELETE FROM notifications
 WHERE related_entity_type = 'achievement';

DELETE FROM department_achievements;

COMMIT;


-- ── 3. Verify empty ─────────────────────────────────────────────────────────
SELECT 'social announcements left' AS what, COUNT(*)::int AS rows FROM social_post_details
UNION ALL SELECT 'achievement posts left', COUNT(*)::int FROM department_achievements
UNION ALL SELECT 'achievement media left', COUNT(*)::int FROM achievement_media
UNION ALL SELECT 'notices kept (expected > 0)', COUNT(*)::int FROM announcements;

-- Note: id sequences are intentionally NOT reset. Reusing ids that old
-- notifications, logs and any cached client still reference is how you get a
-- comment showing up under the wrong post later.
