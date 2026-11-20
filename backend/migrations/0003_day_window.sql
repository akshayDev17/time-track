-- A day is now a window of exactly 24 hours from the moment it started, whatever the clock
-- read then, not its calendar date: open_days.day_start_ms / day_end_ms (and those of every
-- day saved from now on) are that window, [started_at_ms, started_at_ms + 24 h). When the
-- server clock reaches day_end_ms, the next request for that tracker closes the day: every
-- running timer stops at day_end_ms and the day is saved to History.
--
-- A day already open gets its window from its own start; if that end has passed, it closes
-- at that end on its first request. Days already saved keep the calendar bounds they were
-- saved with.
UPDATE open_days SET day_start_ms = started_at_ms, day_end_ms = started_at_ms + 86400000;
