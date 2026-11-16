-- When each timer of the open day last changed (Start, Stop, Clear, or the day or the timer
-- being added), on the server's clock. A timer button's press time is used only when it is
-- not earlier than this; NULL (a row from before this column) always uses the server's clock.
ALTER TABLE open_day_timers ADD COLUMN changed_at_ms INTEGER;
