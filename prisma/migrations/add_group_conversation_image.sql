-- ============================================================================
--  Faculty class groups: group image column
-- ============================================================================
--  message_conversations already has is_group/title columns (previously
--  unused) that this feature activates - the one genuinely new piece is the
--  group's own image, separate from any user's profile image.
--
--  Safe to re-run.
-- ============================================================================

BEGIN;

ALTER TABLE message_conversations
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);

COMMIT;
