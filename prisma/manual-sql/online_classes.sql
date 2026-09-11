-- Real-time video "Online Class" sessions (LiveKit). Brand new feature - no
-- prior table existed (the mobile Online Class screens were UI-only before
-- this). Per this project's "never modify schema.prisma for a small
-- additive table" convention, these are raw-SQL tables (see
-- OnlineClassService) rather than schema.prisma models - doubly so right
-- now since schema.prisma has an unrelated, in-progress merge conflict on
-- this machine that isn't safe to touch.

-- One row per subject/class/day a faculty has actually started a live
-- session for - timetable_slots has no date column (just day_of_week), so
-- class_date pins this to "today's instance" of that recurring slot.
CREATE TABLE IF NOT EXISTS online_classes (
  id SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  class_id INTEGER NOT NULL REFERENCES classes(id),
  faculty_id INTEGER NOT NULL REFERENCES faculty(id),
  class_date DATE NOT NULL,
  period_number SMALLINT,
  status VARCHAR(20) NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'completed')),
  livekit_room_name VARCHAR(100) NOT NULL UNIQUE,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at TIMESTAMPTZ,
  UNIQUE (subject_id, class_id, class_date)
);

-- Join/leave attendance. Multiple rows per (online_class_id, user_id) are
-- allowed on purpose (a dropped connection reconnecting creates a new
-- row) - "currently in the room" is left_at IS NULL on that user's most
-- recent row, not a unique constraint.
CREATE TABLE IF NOT EXISTS online_class_participants (
  id SERIAL PRIMARY KEY,
  online_class_id INTEGER NOT NULL REFERENCES online_classes(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  role VARCHAR(10) NOT NULL CHECK (role IN ('faculty', 'student')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at TIMESTAMPTZ,
  duration_seconds INTEGER
);

CREATE INDEX IF NOT EXISTS idx_online_class_participants_class ON online_class_participants(online_class_id);
CREATE INDEX IF NOT EXISTS idx_online_classes_class_date ON online_classes(class_id, class_date);

-- Real "schedule for later" support (faculty's Online Class -> Schedule
-- tab). Purely additive to the existing table - a scheduled row has
-- status='scheduled' and started_at still NULL until someone actually
-- starts it (startClass() flips scheduled -> live in place, same row/id,
-- rather than inserting a second row - the UNIQUE(subject_id, class_id,
-- class_date) constraint already added above wouldn't allow a second one
-- anyway).
ALTER TABLE online_classes ALTER COLUMN started_at DROP NOT NULL;
ALTER TABLE online_classes ALTER COLUMN started_at DROP DEFAULT;
ALTER TABLE online_classes ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
ALTER TABLE online_classes ADD COLUMN IF NOT EXISTS title VARCHAR(200);
ALTER TABLE online_classes DROP CONSTRAINT IF EXISTS online_classes_status_check;
ALTER TABLE online_classes ADD CONSTRAINT online_classes_status_check
  CHECK (status IN ('scheduled', 'live', 'completed'));
