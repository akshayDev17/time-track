"""What each request does to a user's trackers: the rules (``rules``) over the SQL (``store``).

Every function takes the database, the caller's ``user_id`` and the server's ``now_ms``,
and returns the JSON the router sends. A tracker that is not the caller's is ``NotFound``,
the same as one that does not exist.
"""

from __future__ import annotations

from . import rules, store
from .errors import Conflict, NotFound

DAY_OPEN = "This day is still open. The next one starts once it ends, 24 hours after it began."
ONE_DAY_PER_DATE = "One day per date:"
TIMER_CAP = f"{rules.MAX_TIMERS} of {rules.MAX_TIMERS}: the most a tracker holds."
LAST_TIMER = "A tracker keeps at least one timer."


# ── reads ────────────────────────────────────────────────────────────────────

def _summary(row: dict) -> dict:
    open_day = None
    if row["open_date"] is not None:
        open_day = {"date": row["open_date"], "tz": row["open_tz"], "day_end_ms": row["open_end_ms"], "running": row["running"]}
    return {
        "slug": row["slug"],
        "name": row["name"],
        "timer_count": row["timer_count"],
        "open_day": open_day,
        "last_outcome": row["last_outcome"],
        "saved_date": row["saved_date"],
    }


async def list_trackers(db, user_id: int, now_ms: int) -> dict:
    return {"now_ms": now_ms, "trackers": [_summary(r) for r in await store.tracker_summaries(db, user_id, now_ms)]}


async def _tracker(db, user_id: int, slug: str) -> dict:
    tracker = await store.find_tracker(db, user_id, slug) if isinstance(slug, str) else None
    if tracker is None:
        raise NotFound("No such tracker.")
    return tracker


def _day(day: dict) -> dict:
    keys = ("date", "tz", "tz_label", "day_start_ms", "day_end_ms", "started_at_ms")
    return {k: day[k] for k in keys}


async def _read(db, user_id: int, slug: str, now_ms: int, writes: list = ()) -> dict:
    """``store.read_state`` (after ``writes`` and closing an ended day, in the same batch), or
    ``NotFound``."""
    raw = await store.read_state(db, user_id, slug, now_ms, writes) if isinstance(slug, str) else None
    if raw is None:
        raise NotFound("No such tracker.")
    return raw


def tracker_state(raw: dict, now_ms: int) -> dict:
    """The tracker page's whole state. Timers show the open day's times, and zero with no day
    open; after a day saved itself, ``saved_day`` says which one."""
    tracker, day = raw["tracker"], raw["open_day"]
    saved = raw["saved_day"] if day is None and tracker["last_outcome"] == "saved" else None
    return {
        "now_ms": now_ms,
        "tracker": {
            "slug": tracker["slug"],
            "name": tracker["name"],
            "last_outcome": tracker["last_outcome"],
            "phase": rules.day_phase(day, now_ms),
            "open_day": _day(day) if day else None,
            "saved_day": {**_day(saved), "saved_at_ms": saved["saved_at_ms"]} if saved else None,
            "timers": [
                {
                    "id": t["id"],
                    "name": t["name"],
                    "acc_ms": (t["acc_ms"] or 0) if day else 0,
                    "running_since_ms": t["running_since_ms"] if day else None,
                }
                for t in raw["timers"]
            ],
        },
    }


async def get_tracker(db, user_id: int, slug: str, now_ms: int) -> dict:
    return tracker_state(await _read(db, user_id, slug, now_ms), now_ms)


async def get_history(db, user_id: int, slug: str, now_ms: int) -> dict:
    tracker = await _tracker(db, user_id, slug)
    await store.close_ended_day(db, user_id, slug, now_ms)
    timers, days, values = await store.history(db, tracker["id"])
    by_day: dict[int, dict[str, int]] = {d["id"]: {} for d in days}
    for v in values:
        by_day[v["day_id"]][str(v["timer_id"])] = v["ms"]
    number = 0
    out = []
    for t in timers:
        if t["removed_on"] is None:
            number += 1
        out.append({"id": t["id"], "name": t["name"], "number": number if t["removed_on"] is None else None,
                    "removed_on": t["removed_on"]})
    return {
        "now_ms": now_ms,
        "name": tracker["name"],
        "slug": tracker["slug"],
        "timers": out,
        "days": [{"date": d["date"], "tz_label": d["tz_label"], "values": by_day[d["id"]]} for d in days],
    }


# ── trackers ─────────────────────────────────────────────────────────────────

async def create_tracker(db, user_id: int, body: dict, now_ms: int) -> dict:
    name = rules.tracker_name(body.get("name"))
    count = rules.timer_count(body.get("timers"))
    for _ in range(2):
        slug = rules.unique_slug(name, await store.taken_slugs(db, user_id))
        try:
            await store.create_tracker(db, user_id, slug, name, count, now_ms)
        except Exception as error:
            if not store.is_unique_violation(error):
                raise
            continue
        return await get_tracker(db, user_id, slug, now_ms)
    raise Conflict("Another tracker took that name just now. Try again.", "slug_taken")


async def delete_tracker(db, user_id: int, slug: str) -> None:
    await store.delete_tracker(db, (await _tracker(db, user_id, slug))["id"])


# ── days ─────────────────────────────────────────────────────────────────────

def _any_running(state: dict) -> int:
    return sum(1 for t in state["tracker"]["timers"] if t["running_since_ms"] is not None)


async def start_today(db, user_id: int, slug: str, body: dict, now_ms: int) -> dict:
    """Open today's day with every timer at zero, for exactly 24 hours from now.

    Refused while a day is open (its window has not ended: one that has is closed and saved by
    the read first), and when this date is already saved: one day per date.
    """
    raw = await _read(db, user_id, slug, now_ms)
    stamp = rules.day_stamp(body, now_ms)
    tracker = raw["tracker"]
    if raw["open_day"] is not None:
        raise Conflict(DAY_OPEN, "day_open")
    if await store.has_saved_date(db, tracker["id"], stamp["date"]):
        raise Conflict(f"{ONE_DAY_PER_DATE} {stamp['date']} is already saved.", "date_taken")
    try:
        await db.batch(store.start_day_statements(db, tracker["id"], stamp, now_ms))
    except Exception as error:
        if store.is_unique_violation(error):
            raise Conflict(DAY_OPEN, "day_open") from error
        raise
    return await get_tracker(db, user_id, slug, now_ms)


async def discard_day(db, user_id: int, slug: str, now_ms: int) -> dict:
    """Discard last day: the open day, before its end, deleted for good, never in History or
    on the Charts page."""
    raw = await _read(db, user_id, slug, now_ms)
    day = raw["open_day"]
    if day is None:
        raise Conflict("Nothing to discard.", "no_day")
    await db.batch(store.discard_day_statements(db, raw["tracker"]["id"], day["started_at_ms"]))
    return await get_tracker(db, user_id, slug, now_ms)


# ── timers ───────────────────────────────────────────────────────────────────

def _check_live(state: dict) -> None:
    """Refuse unless a day is open (one past its end was closed by the read)."""
    if state["tracker"]["phase"] == rules.LIVE:
        return
    if state["tracker"]["last_outcome"] == "saved":
        raise Conflict("This day has ended and saved itself. Press Start today for the next one.", "day_ended")
    raise Conflict("Press Start today first.", "no_day")


async def _live(db, user_id: int, slug: str, now_ms: int) -> tuple[dict, dict]:
    """The tracker and its state, refusing unless its day is open."""
    raw = await _read(db, user_id, slug, now_ms)
    state = tracker_state(raw, now_ms)
    _check_live(state)
    return raw["tracker"], state


def _timer(state: dict, timer_id: object) -> dict:
    for t in state["tracker"]["timers"]:
        if t["id"] == timer_id:
            return t
    raise NotFound("No such timer.")


_TIMER_WRITES = {"start": store.start_timer, "stop": store.stop_timer, "clear": store.clear_timer}
_TRACKER_WRITES = {"start-all": store.start_all, "stop-all": store.stop_all, "relaunch": store.relaunch, "clear-all": store.clear_all}


async def timer_action(db, user_id: int, slug: str, timer_id: int, action: str, body: dict, now_ms: int) -> dict:
    """Start, Stop or Clear one timer in one round trip: the write, guarded in SQL by the same
    rules checked here, runs in one batch with the reads of the state it leaves. A refused
    write changed nothing, so the state read with it says why. Stamped with the press time
    (``rules.press_time``), so a press queued behind another one is not stamped late."""
    write = _TIMER_WRITES[action](db, user_id, slug, timer_id, rules.press_time(body, now_ms), now_ms)
    state = tracker_state(await _read(db, user_id, slug, now_ms, [write]), now_ms)
    if action != "stop":  # a Stop that finds the day already closed has nothing left to do
        _check_live(state)
    timer = _timer(state, timer_id)
    if action == "clear" and timer["running_since_ms"] is not None:
        raise Conflict("Stop the timer before clearing it.", "timer_running")
    return state


async def tracker_action(db, user_id: int, slug: str, action: str, body: dict, now_ms: int) -> dict:
    """Start all, Stop all, Relaunch or Clear all, in one round trip like ``timer_action``."""
    write = _TRACKER_WRITES[action](db, user_id, slug, rules.press_time(body, now_ms), now_ms)
    state = tracker_state(await _read(db, user_id, slug, now_ms, [write]), now_ms)
    if action != "stop-all":
        _check_live(state)
    if action == "clear-all" and _any_running(state):
        raise Conflict("Clear all waits until every timer is stopped.", "timers_running")
    return state


async def rename_timer(db, user_id: int, slug: str, timer_id: int, body: dict, now_ms: int) -> dict:
    tracker, state = await _live(db, user_id, slug, now_ms)
    timer = _timer(state, timer_id)
    await store.rename_timer(db, tracker["id"], timer["id"], rules.timer_name(body.get("name")))
    return await get_tracker(db, user_id, slug, now_ms)


async def add_timer(db, user_id: int, slug: str, now_ms: int) -> dict:
    tracker, state = await _live(db, user_id, slug, now_ms)
    if len(state["tracker"]["timers"]) >= rules.MAX_TIMERS or not await store.add_timer(db, tracker["id"], rules.MAX_TIMERS, now_ms):
        raise Conflict(TIMER_CAP, "timer_cap")
    return await get_tracker(db, user_id, slug, now_ms)


async def remove_timer(db, user_id: int, slug: str, timer_id: int, now_ms: int) -> dict:
    tracker, state = await _live(db, user_id, slug, now_ms)
    timer = _timer(state, timer_id)
    if len(state["tracker"]["timers"]) <= 1:
        raise Conflict(LAST_TIMER, "last_timer")
    await store.remove_timer(db, tracker["id"], timer["id"], state["tracker"]["open_day"]["date"])
    after = await get_tracker(db, user_id, slug, now_ms)
    if any(t["id"] == timer["id"] for t in after["tracker"]["timers"]):
        raise Conflict(LAST_TIMER, "last_timer")
    return after
