/** The API's JSON, as backend/time_track/trackers.py writes it. */

export type Timer = { id: number; name: string; acc_ms: number; running_since_ms: number | null };

export type Day = {
  date: string;
  tz: string;
  tz_label: string;
  day_start_ms: number;
  day_end_ms: number;
  started_at_ms: number;
};

export type Tracker = {
  slug: string;
  name: string;
  last_outcome: 'saved' | 'discarded' | null;
  phase: 'live' | 'ended' | null;
  open_day: Day | null;
  saved_day: (Day & { saved_at_ms: number }) | null;
  timers: Timer[];
};

export type TrackerResponse = { now_ms: number; tracker: Tracker };

export type TrackerSummary = {
  slug: string;
  name: string;
  timer_count: number;
  open_day: { date: string; day_end_ms: number; running: number } | null;
  last_outcome: 'saved' | 'discarded' | null;
  saved_date: string | null;
};

export type TrackersResponse = { now_ms: number; trackers: TrackerSummary[] };

export type HistoryTimer = { id: number; name: string; number: number | null; removed_on: string | null };
export type HistoryResponse = {
  now_ms: number;
  name: string;
  slug: string;
  timers: HistoryTimer[];
  days: { date: string; tz_label: string; values: Record<string, number> }[];
};

export type Me = { email: string; now_ms: number };
