"""Every SQL statement the app runs, over a D1 binding (or ``SqliteD1`` in tests).

Reads return plain dicts. Writes that must land together come back as statement lists for
one ``db.batch`` (one transaction). Every tracker read is scoped by ``user_id``.
"""

from __future__ import annotations

_TRACKER = "SELECT id, user_id, slug, name, last_outcome FROM trackers"


def is_unique_violation(error: BaseException) -> bool:
    """A write lost a race to a UNIQUE or PRIMARY KEY row another request just wrote
    (``sqlite3.IntegrityError`` and D1's error both say so in their message)."""
    return "UNIQUE constraint failed" in str(error)


async def upsert_user(db, email: str, now_ms: int) -> int:
    await db.prepare(
        "INSERT INTO users (email, created_at_ms) VALUES (?, ?) ON CONFLICT(email) DO NOTHING"
    ).bind(email, now_ms).run()
    row = await db.prepare("SELECT id FROM users WHERE email = ?").bind(email).first()
    return row["id"]


async def tracker_summaries(db, user_id: int) -> list[dict]:
    """One row per tracker, oldest first, with what its list row shows."""
    return (await db.prepare(
        """SELECT tr.id, tr.slug, tr.name, tr.last_outcome,
                  (SELECT COUNT(*) FROM timers t WHERE t.tracker_id = tr.id AND t.removed_on IS NULL) AS timer_count,
                  od.date AS open_date, od.day_end_ms AS open_end_ms,
                  (SELECT COUNT(*) FROM open_day_timers o
                     WHERE o.tracker_id = tr.id AND o.running_since_ms IS NOT NULL) AS running,
                  (SELECT h.date FROM history_days h WHERE h.tracker_id = tr.id
                     ORDER BY h.saved_at_ms DESC, h.id DESC LIMIT 1) AS saved_date
             FROM trackers tr LEFT JOIN open_days od ON od.tracker_id = tr.id
            WHERE tr.user_id = ?
            ORDER BY tr.created_at_ms, tr.id"""
    ).bind(user_id).all()).results


async def taken_slugs(db, user_id: int) -> set[str]:
    rows = (await db.prepare("SELECT slug FROM trackers WHERE user_id = ?").bind(user_id).all()).results
    return {r["slug"] for r in rows}


async def create_tracker(db, user_id: int, slug: str, name: str, count: int, now_ms: int) -> None:
    await db.batch([
        db.prepare("INSERT INTO trackers (user_id, slug, name, created_at_ms) VALUES (?, ?, ?, ?)").bind(user_id, slug, name, now_ms),
        *[
            db.prepare(
                "INSERT INTO timers (tracker_id, position, name) "
                "SELECT id, ?, '' FROM trackers WHERE user_id = ? AND slug = ?"
            ).bind(position, user_id, slug)
            for position in range(1, count + 1)
        ],
    ])


async def find_tracker(db, user_id: int, slug: str) -> dict | None:
    return await db.prepare(f"{_TRACKER} WHERE user_id = ? AND slug = ?").bind(user_id, slug).first()


async def delete_tracker(db, tracker_id: int) -> None:
    """Everything in it goes with it (every child table cascades from trackers)."""
    await db.prepare("DELETE FROM trackers WHERE id = ?").bind(tracker_id).run()


async def open_day(db, tracker_id: int) -> dict | None:
    return await db.prepare(
        "SELECT date, tz, tz_label, day_start_ms, day_end_ms, started_at_ms FROM open_days WHERE tracker_id = ?"
    ).bind(tracker_id).first()


async def current_timers(db, tracker_id: int) -> list[dict]:
    """The tracker's timers in order, each with its open-day time (NULL when no day is open)."""
    return (await db.prepare(
        """SELECT t.id, t.name, o.acc_ms, o.running_since_ms
             FROM timers t LEFT JOIN open_day_timers o ON o.timer_id = t.id
            WHERE t.tracker_id = ? AND t.removed_on IS NULL
            ORDER BY t.position, t.id"""
    ).bind(tracker_id).all()).results


async def latest_saved_day(db, tracker_id: int) -> dict | None:
    day = await db.prepare(
        """SELECT id, date, tz, tz_label, day_start_ms, day_end_ms, started_at_ms, saved_at_ms
             FROM history_days WHERE tracker_id = ? ORDER BY saved_at_ms DESC, id DESC LIMIT 1"""
    ).bind(tracker_id).first()
    if day is None:
        return None
    rows = (await db.prepare("SELECT timer_id, ms FROM history_values WHERE day_id = ?").bind(day["id"]).all()).results
    return {**day, "values": {r["timer_id"]: r["ms"] for r in rows}}


async def has_saved_date(db, tracker_id: int, date: str) -> bool:
    row = await db.prepare("SELECT 1 AS hit FROM history_days WHERE tracker_id = ? AND date = ?").bind(tracker_id, date).first()
    return row is not None


async def history(db, tracker_id: int) -> tuple[list[dict], list[dict], list[dict]]:
    """(timers, days, values) for the Charts page: current timers in order, then removed
    timers that have saved days; every saved day by date; every saved value."""
    timers = (await db.prepare(
        """SELECT t.id, t.name, t.removed_on FROM timers t
            WHERE t.tracker_id = ?
              AND (t.removed_on IS NULL OR EXISTS (SELECT 1 FROM history_values v WHERE v.timer_id = t.id))
            ORDER BY t.removed_on IS NOT NULL, t.position, t.id"""
    ).bind(tracker_id).all()).results
    days = (await db.prepare(
        "SELECT id, date, tz_label FROM history_days WHERE tracker_id = ? ORDER BY date"
    ).bind(tracker_id).all()).results
    values = (await db.prepare(
        """SELECT v.day_id, v.timer_id, v.ms FROM history_values v
             JOIN history_days h ON h.id = v.day_id WHERE h.tracker_id = ?"""
    ).bind(tracker_id).all()).results
    return timers, days, values


# ── day writes, as statement lists for one batch ─────────────────────────────

def save_day_statements(db, tracker_id: int, date: str, now_ms: int) -> list:
    """Move the open day of ``date`` into History. A timer still running is saved with its
    time up to now, so a run started between the check and this batch is never lost. When
    another request has already replaced that day, nothing changes."""
    return [
        db.prepare(
            """INSERT INTO history_days (tracker_id, date, tz, tz_label, day_start_ms, day_end_ms, started_at_ms, saved_at_ms)
               SELECT tracker_id, date, tz, tz_label, day_start_ms, day_end_ms, started_at_ms, ?
                 FROM open_days WHERE tracker_id = ? AND date = ?"""
        ).bind(now_ms, tracker_id, date),
        db.prepare(
            """INSERT INTO history_values (day_id, timer_id, ms)
               SELECT h.id, o.timer_id,
                      o.acc_ms + CASE WHEN o.running_since_ms IS NULL THEN 0 ELSE MAX(0, ? - o.running_since_ms) END
                 FROM open_day_timers o
                 JOIN open_days d ON d.tracker_id = o.tracker_id
                 JOIN history_days h ON h.tracker_id = d.tracker_id AND h.date = d.date
                 JOIN timers t ON t.id = o.timer_id AND t.removed_on IS NULL
                WHERE o.tracker_id = ? AND d.date = ?"""
        ).bind(now_ms, tracker_id, date),
        *_close_day_statements(db, tracker_id, date, "saved"),
    ]


def discard_day_statements(db, tracker_id: int, date: str) -> list:
    """Delete the open day of ``date`` completely: its times never reach History."""
    return _close_day_statements(db, tracker_id, date, "discarded")


def _close_day_statements(db, tracker_id: int, date: str, outcome: str) -> list:
    return [
        db.prepare(
            "UPDATE trackers SET last_outcome = ? WHERE id = ? "
            "AND EXISTS (SELECT 1 FROM open_days WHERE tracker_id = ? AND date = ?)"
        ).bind(outcome, tracker_id, tracker_id, date),
        db.prepare("DELETE FROM open_days WHERE tracker_id = ? AND date = ?").bind(tracker_id, date),
    ]


def start_day_statements(db, tracker_id: int, stamp: dict, now_ms: int) -> list:
    """Open today's day with every current timer at zero."""
    return [
        db.prepare(
            """INSERT INTO open_days (tracker_id, date, tz, tz_label, day_start_ms, day_end_ms, started_at_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?)"""
        ).bind(tracker_id, stamp["date"], stamp["tz"], stamp["tz_label"], stamp["day_start_ms"], stamp["day_end_ms"], now_ms),
        db.prepare(
            "INSERT INTO open_day_timers (timer_id, tracker_id) SELECT id, ? FROM timers WHERE tracker_id = ? AND removed_on IS NULL"
        ).bind(tracker_id, tracker_id),
        db.prepare("UPDATE trackers SET last_outcome = NULL WHERE id = ?").bind(tracker_id),
    ]


# ── timer writes (each one statement, stamped with the server's clock) ───────

async def start_timer(db, tracker_id: int, timer_id: int, now_ms: int) -> None:
    await db.prepare(
        "UPDATE open_day_timers SET running_since_ms = ? WHERE tracker_id = ? AND timer_id = ? AND running_since_ms IS NULL"
    ).bind(now_ms, tracker_id, timer_id).run()


_STOP = "acc_ms = acc_ms + MAX(0, ? - running_since_ms), running_since_ms = NULL"


async def stop_timer(db, tracker_id: int, timer_id: int, now_ms: int) -> None:
    await db.prepare(
        f"UPDATE open_day_timers SET {_STOP} WHERE tracker_id = ? AND timer_id = ? AND running_since_ms IS NOT NULL"
    ).bind(now_ms, tracker_id, timer_id).run()


async def clear_timer(db, tracker_id: int, timer_id: int) -> None:
    await db.prepare(
        "UPDATE open_day_timers SET acc_ms = 0 WHERE tracker_id = ? AND timer_id = ? AND running_since_ms IS NULL"
    ).bind(tracker_id, timer_id).run()


async def start_all(db, tracker_id: int, now_ms: int) -> None:
    """Start every timer at zero; one with time is left as it is."""
    await db.prepare(
        "UPDATE open_day_timers SET running_since_ms = ? WHERE tracker_id = ? AND running_since_ms IS NULL AND acc_ms = 0"
    ).bind(now_ms, tracker_id).run()


async def stop_all(db, tracker_id: int, now_ms: int) -> None:
    await db.prepare(
        f"UPDATE open_day_timers SET {_STOP} WHERE tracker_id = ? AND running_since_ms IS NOT NULL"
    ).bind(now_ms, tracker_id).run()


async def relaunch(db, tracker_id: int, now_ms: int) -> None:
    """Resume every stopped timer that has time; none is reset."""
    await db.prepare(
        "UPDATE open_day_timers SET running_since_ms = ? WHERE tracker_id = ? AND running_since_ms IS NULL AND acc_ms > 0"
    ).bind(now_ms, tracker_id).run()


async def clear_all(db, tracker_id: int) -> None:
    await db.prepare(
        "UPDATE open_day_timers SET acc_ms = 0 WHERE tracker_id = ? AND NOT EXISTS "
        "(SELECT 1 FROM open_day_timers r WHERE r.tracker_id = ? AND r.running_since_ms IS NOT NULL)"
    ).bind(tracker_id, tracker_id).run()


async def rename_timer(db, tracker_id: int, timer_id: int, name: str) -> None:
    await db.prepare(
        "UPDATE timers SET name = ? WHERE tracker_id = ? AND id = ? AND removed_on IS NULL"
    ).bind(name, tracker_id, timer_id).run()


_CURRENT_COUNT = "(SELECT COUNT(*) FROM timers c WHERE c.tracker_id = ? AND c.removed_on IS NULL)"


async def add_timer(db, tracker_id: int, cap: int) -> bool:
    """Add a timer at zero to the open day. False, with nothing written, when the tracker
    already holds ``cap``: the new timer gets no position and the batch fails."""
    try:
        await db.batch([
            db.prepare(
                "INSERT INTO timers (tracker_id, position, name) VALUES (?, CASE WHEN "
                f"{_CURRENT_COUNT} < ? THEN (SELECT COALESCE(MAX(position), 0) + 1 FROM timers WHERE tracker_id = ?) END, '')"
            ).bind(tracker_id, tracker_id, cap, tracker_id),
            db.prepare(
                "INSERT INTO open_day_timers (timer_id, tracker_id) "
                "SELECT t.id, ? FROM timers t WHERE t.tracker_id = ? AND t.removed_on IS NULL "
                "AND NOT EXISTS (SELECT 1 FROM open_day_timers o WHERE o.timer_id = t.id)"
            ).bind(tracker_id, tracker_id),
        ])
    except Exception as error:
        if "NOT NULL constraint failed: timers.position" in str(error):
            return False
        raise
    return True


async def remove_timer(db, tracker_id: int, timer_id: int, removed_on: str) -> None:
    """Drop the timer and its time today. One with saved days stays, marked removed, so its
    graph stays on the Charts page; one without is deleted. The last timer always stays."""
    await db.batch([
        db.prepare(
            f"DELETE FROM open_day_timers WHERE tracker_id = ? AND timer_id = ? AND {_CURRENT_COUNT} > 1"
        ).bind(tracker_id, timer_id, tracker_id),
        db.prepare(
            "UPDATE timers SET removed_on = ? WHERE tracker_id = ? AND id = ? "
            f"AND EXISTS (SELECT 1 FROM history_values v WHERE v.timer_id = timers.id) AND {_CURRENT_COUNT} > 1"
        ).bind(removed_on, tracker_id, timer_id, tracker_id),
        db.prepare(
            f"DELETE FROM timers WHERE tracker_id = ? AND id = ? AND removed_on IS NULL AND {_CURRENT_COUNT} > 1"
        ).bind(tracker_id, timer_id, tracker_id),
    ])
