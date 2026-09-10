-- Two additions enabling the Social Media Publishing "App Explore feed" tab
-- and the Report page's real "Turnaround time" panel. Not in schema.prisma
-- by design — accessed only via $queryRaw/$executeRaw.

-- ── Comments on announcements ────────────────────────────────────────────────
-- Mirrors the real, already-working achievement_comments table exactly (same
-- shape, same moderation rule: own comment, or the announcement's poster, or
-- Admin). Lets Media Room actually "manage the comments students leave" on
-- their posts, as the page's own subtitle already claims — today nothing
-- backs that at all.
CREATE TABLE IF NOT EXISTS announcement_comments (
  id SERIAL PRIMARY KEY,
  announcement_id INT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  commented_by_user_id INT NOT NULL REFERENCES users(id),
  comment_text TEXT NOT NULL,
  -- One level of reply only (mirrors the design's c.reply field) — Media
  -- Room replying to a student's comment. NULL = a top-level comment.
  parent_comment_id INT REFERENCES announcement_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_announcement_comments_announcement ON announcement_comments(announcement_id, created_at);
CREATE INDEX IF NOT EXISTS idx_announcement_comments_parent ON announcement_comments(parent_comment_id);

-- ── Social post metadata (Explore feed composer extras) ──────────────────────
-- The design's "New post" composer asks for a format tag, a link, whether
-- the post is pinned, whether comments are open, and an optional expiry —
-- none of that fits generically on the shared `announcements` table (every
-- other role that posts an announcement has no use for them), so it lives
-- in a slim, optional 1:1 companion table instead. A row only exists for
-- posts actually created through the Social Media Publishing composer;
-- every other announcement simply has none, and the app treats a missing
-- row as is_pinned=false / allow_comments=true (the same defaults it would
-- have had anyway).
CREATE TABLE IF NOT EXISTS social_post_details (
  announcement_id INT PRIMARY KEY REFERENCES announcements(id) ON DELETE CASCADE,
  format VARCHAR(30),
  link_url TEXT,
  expires_at TIMESTAMPTZ,
  is_pinned BOOLEAN,
  allow_comments BOOLEAN,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Media request status history ─────────────────────────────────────────────
-- The design's "Turnaround time" panel (Under 24h / 1-3 days / 4-7 days /
-- Over a week) needs a real timestamp for when a request moved between
-- statuses — media_requests itself only has created_at, nothing for
-- approved_at/delivered_at. This is an append-only log written by Media
-- Room's own PATCH (the one place status changes), so turnaround time
-- becomes genuinely computable instead of the design's hardcoded numbers.
CREATE TABLE IF NOT EXISTS media_request_status_log (
  id SERIAL PRIMARY KEY,
  media_request_id INT NOT NULL REFERENCES media_requests(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_media_request_status_log_request ON media_request_status_log(media_request_id);

-- ── Media scorecard targets ──────────────────────────────────────────────────
-- The Report page's "Media scorecard" panel (this year / last year / target /
-- attainment) is otherwise fully computable from real, already-existing data
-- (media_requests, media_shoot_assignments, announcements, notifications,
-- announcement_comments, media_equipment_movements) — every column except
-- TARGET, which isn't derived from anything; it's a goal Media Room sets for
-- itself. This is the one small table that goal actually lives in, so
-- ATTAINMENT (this year ÷ target) is a real percentage instead of a
-- hardcoded one. One row per metric per academic year.
CREATE TABLE IF NOT EXISTS media_scorecard_targets (
  id SERIAL PRIMARY KEY,
  metric_key VARCHAR(50) NOT NULL,
  academic_year VARCHAR(10) NOT NULL,
  target_value NUMERIC(10, 2) NOT NULL,
  updated_by_user_id INT NOT NULL REFERENCES users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (metric_key, academic_year)
);
