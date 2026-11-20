"""The tracker rules that need no database: pure functions of their arguments.

Times are epoch milliseconds from the server's clock. A Day is stamped with the date and
time zone where Start today was pressed (the browser reads both from its own zone data and
sends them, with the server times that date starts and ends there, so the server can check
the date is today). The day itself is a window of exactly 24 hours from the moment Start
today reached the server, whatever the clock read then: [start, start + DAY_MS). When the
server clock reaches its end, the day closes itself (``store.close_ended_days``).
"""

from __future__ import annotations

import re
from datetime import date as Date

from .errors import Invalid

MAX_TIMERS = 15
NAME_MAX = 60
TZ_MAX = 64
TZ_LABEL_MAX = 80
UNTITLED = "Untitled tracker"

HOUR_MS = 3_600_000
#: A day's window: it ends exactly this long after it started, whatever the date or zone.
DAY_MS = 24 * HOUR_MS
#: A calendar day is 24 h, or 23 h / 25 h (and 23.5 h / 24.5 h on Lord Howe) across a DST change.
MIN_DAY_MS = 22 * HOUR_MS
MAX_DAY_MS = 26 * HOUR_MS
#: How far ahead of the server a browser's idea of the day's start may be (its clock is synced
#: to the server's, so this only absorbs the round trip).
SKEW_MS = 120_000
#: A timer button's press time (the page's reading of the server clock at the click) is used
#: when it is at most this old when the server hears it, and at most PRESS_SKEW_MS ahead.
PRESS_MAX_AGE_MS = 10_000
PRESS_SKEW_MS = 1_000

#: First path segments the app's own pages and files use, so no tracker may take them.
RESERVED_SLUGS = frozenset({"api", "new", "signin", "tracker", "charts", "index", "404", "_next", "_site"})
SLUG_MAX = 40

LIVE = "live"

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def day_phase(open_day: dict | None, now_ms: int) -> str | None:
    """``live`` while the open day's window has not ended, else ``None``. Every read closes an
    ended day first, so an open day the store answers with is always live."""
    return LIVE if open_day is not None and now_ms < open_day["day_end_ms"] else None


def elapsed_ms(acc_ms: int, running_since_ms: int | None, now_ms: int) -> int:
    """A timer's time: its closed intervals plus the current run, never negative."""
    return acc_ms + (max(0, now_ms - running_since_ms) if running_since_ms is not None else 0)


def tracker_name(raw: object) -> str:
    if raw is None:
        return UNTITLED
    if not isinstance(raw, str):
        raise Invalid("name must be text")
    name = raw.strip()
    if len(name) > NAME_MAX:
        raise Invalid(f"A tracker name is at most {NAME_MAX} characters.")
    return name or UNTITLED


def timer_name(raw: object) -> str:
    if not isinstance(raw, str):
        raise Invalid("name must be text")
    name = raw.strip()
    if len(name) > NAME_MAX:
        raise Invalid(f"A timer name is at most {NAME_MAX} characters.")
    return name


def timer_count(raw: object) -> int:
    if not isinstance(raw, int) or isinstance(raw, bool) or not 1 <= raw <= MAX_TIMERS:
        raise Invalid(f"A tracker holds 1 to {MAX_TIMERS} timers.")
    return raw


def slugify(name: str) -> str:
    """``"Guitar practice"`` -> ``"guitar-practice"``; nothing usable -> ``"untitled"``."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:SLUG_MAX].strip("-")
    return slug or "untitled"


def unique_slug(name: str, taken: set[str]) -> str:
    """The name's slug, numbered (``-2``, ``-3``, ...) past reserved and taken ones."""
    base = slugify(name)
    if base not in RESERVED_SLUGS and base not in taken:
        return base
    n = 2
    while f"{base}-{n}" in taken:
        n += 1
    return f"{base}-{n}"


def _int(body: dict, key: str) -> int:
    value = body.get(key)
    if not isinstance(value, int) or isinstance(value, bool):
        raise Invalid(f"{key} must be an integer")
    return value


def _text(body: dict, key: str, limit: int) -> str:
    value = body.get(key)
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise Invalid(f"{key} must be text of 1 to {limit} characters")
    return value.strip()


def day_stamp(body: dict, now_ms: int) -> dict:
    """The Start today stamp, checked against the server clock, and the day's window.

    ``date`` is the local calendar date, ``tz`` the IANA zone and ``tz_label`` how pages name
    it ("Pune (IST)"); the body's ``day_start_ms`` / ``day_end_ms`` are when that date starts
    and ends in that zone, and now must fall inside them, so a day is always today's where it
    started. The answer's ``day_start_ms`` / ``day_end_ms`` are the day's window instead:
    now, and exactly ``DAY_MS`` later.
    """
    date = body.get("date")
    if not isinstance(date, str) or not _DATE.match(date):
        raise Invalid("date must be YYYY-MM-DD")
    try:
        Date.fromisoformat(date)
    except ValueError:
        raise Invalid("date must be a real calendar date") from None
    tz = _text(body, "tz", TZ_MAX)
    tz_label = _text(body, "tz_label", TZ_LABEL_MAX)
    start, end = _int(body, "day_start_ms"), _int(body, "day_end_ms")
    if not MIN_DAY_MS <= end - start <= MAX_DAY_MS:
        raise Invalid("day_start_ms and day_end_ms must span one calendar day")
    if not (start - SKEW_MS <= now_ms < end):
        raise Invalid("That date is not today where you are. Reload the page and press Start today again.", "date_not_today")
    return {"date": date, "tz": tz, "tz_label": tz_label, "day_start_ms": now_ms, "day_end_ms": now_ms + DAY_MS}


def press_time(body: dict, now_ms: int) -> int:
    """When a timer button was pressed: the page's ``pressed_at_ms`` (on the server's clock)
    when it lies in [now - PRESS_MAX_AGE_MS, now + PRESS_SKEW_MS], else now. The store also
    falls back to now for a timer whose last change is later than it."""
    value = body.get("pressed_at_ms")
    if isinstance(value, int) and not isinstance(value, bool) and now_ms - PRESS_MAX_AGE_MS <= value <= now_ms + PRESS_SKEW_MS:
        return value
    return now_ms
