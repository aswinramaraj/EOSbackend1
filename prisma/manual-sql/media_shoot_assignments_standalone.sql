-- Extends media_shoot_assignments to support a second, standalone creation
-- path for the Academic Calendar page's "+ Add media event" form.
--
-- That form's fields (Event title, Date, Call time, Coverage type, Crew,
-- Venue) don't map to any real institution academic_calendar_events row —
-- "Event title" is free text, not a picker over real calendar events, and
-- the original design's own onClick handlers never actually saved anything
-- (Cancel and "Add to calendar" call the identical no-op). Rather than fake
-- a link to a real calendar event that isn't there, this makes it a second
-- honest, standalone entry in the same real table Shoot Assignments already
-- uses — media_request_id becomes optional, and two new free-text columns
-- (event_title, venue) cover what a linked media_request would otherwise
-- have supplied. Every row must have exactly one "source": a real
-- media_request_id (existing flow, from the Media Requests queue) OR a
-- standalone event_title (new flow, from the Calendar page) — never both,
-- never neither.
--
-- Existing row(s) are untouched — media_request_id stays populated for them.

ALTER TABLE media_shoot_assignments ALTER COLUMN media_request_id DROP NOT NULL;
ALTER TABLE media_shoot_assignments ADD COLUMN IF NOT EXISTS event_title VARCHAR(255);
ALTER TABLE media_shoot_assignments ADD COLUMN IF NOT EXISTS venue VARCHAR(255);

ALTER TABLE media_shoot_assignments ADD CONSTRAINT media_shoot_assignments_source_check CHECK (
  (media_request_id IS NOT NULL AND event_title IS NULL) OR
  (media_request_id IS NULL AND event_title IS NOT NULL)
);
