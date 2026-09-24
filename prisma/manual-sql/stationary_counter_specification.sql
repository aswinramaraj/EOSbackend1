-- Counter entries describe their job as one free-text "Specification"
-- string (e.g. "B&W · A4 · single side"), per the Stationery Portal design -
-- not the online form's structured orientation/color_mode/paper_size/sides
-- pickers, which stay NOT NULL/enum-typed for that flow and are simply
-- given sensible defaults on a counter row (see StationaryService.
-- createCounterEntry) since they don't apply.
ALTER TABLE stationary_requests
  ADD COLUMN IF NOT EXISTS specification VARCHAR(150);
