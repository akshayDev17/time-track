-- Time Track schema.
--
-- A Tracker holds 1 to 15 Timers. Start today opens a Day for one date; that
-- Open day lives in open_days (one row per tracker at most) with each timer's
-- time in open_day_timers. Save last day moves it into history_days +
-- history_values; Discard last day deletes it. Times are never ticking
-- counters: acc_ms is the sum of closed run intervals and running_since_ms is
-- the server time the current run started (NULL when stopped), so every
-- device computes the same elapsed time from the server's clock.

CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  email         TEXT    NOT NULL UNIQUE,
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE trackers (
  id            INTEGER PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug          TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  -- What happened to the last day when no day is open: NULL (never started,
  -- or a day is open), 'saved' (the page shows that saved day, read-only) or
  -- 'discarded'.
  last_outcome  TEXT    CHECK (last_outcome IN ('saved', 'discarded')),
  created_at_ms INTEGER NOT NULL,
  UNIQUE (user_id, slug)
);

-- removed_on is NULL for a current timer. A removed timer that has saved days
-- stays, so its graph stays on the Charts page marked removed; one with no
-- saved days is deleted outright.
CREATE TABLE timers (
  id         INTEGER PRIMARY KEY,
  tracker_id INTEGER NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  name       TEXT    NOT NULL DEFAULT '',
  removed_on TEXT
);
CREATE INDEX timers_by_tracker ON timers (tracker_id, position);

-- The Open day: the date and time zone where Start today was pressed, and the
-- server times that date starts and ends in that zone.
CREATE TABLE open_days (
  tracker_id    INTEGER PRIMARY KEY REFERENCES trackers(id) ON DELETE CASCADE,
  date          TEXT    NOT NULL,
  tz            TEXT    NOT NULL,
  tz_label      TEXT    NOT NULL,
  day_start_ms  INTEGER NOT NULL,
  day_end_ms    INTEGER NOT NULL,
  started_at_ms INTEGER NOT NULL
);

CREATE TABLE open_day_timers (
  timer_id         INTEGER PRIMARY KEY REFERENCES timers(id) ON DELETE CASCADE,
  tracker_id       INTEGER NOT NULL REFERENCES open_days(tracker_id) ON DELETE CASCADE,
  acc_ms           INTEGER NOT NULL DEFAULT 0,
  running_since_ms INTEGER
);
CREATE INDEX open_day_timers_by_tracker ON open_day_timers (tracker_id);

-- History: one saved Day per date per tracker.
CREATE TABLE history_days (
  id            INTEGER PRIMARY KEY,
  tracker_id    INTEGER NOT NULL REFERENCES trackers(id) ON DELETE CASCADE,
  date          TEXT    NOT NULL,
  tz            TEXT    NOT NULL,
  tz_label      TEXT    NOT NULL,
  day_start_ms  INTEGER NOT NULL,
  day_end_ms    INTEGER NOT NULL,
  started_at_ms INTEGER NOT NULL,
  saved_at_ms   INTEGER NOT NULL,
  UNIQUE (tracker_id, date)
);

CREATE TABLE history_values (
  day_id   INTEGER NOT NULL REFERENCES history_days(id) ON DELETE CASCADE,
  timer_id INTEGER NOT NULL REFERENCES timers(id) ON DELETE CASCADE,
  ms       INTEGER NOT NULL,
  PRIMARY KEY (day_id, timer_id)
);
CREATE INDEX history_values_by_timer ON history_values (timer_id);
