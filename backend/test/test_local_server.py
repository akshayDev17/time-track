"""The local dev server's SQLite file follows the migrations (production uses wrangler's)."""

from __future__ import annotations

import importlib
import sqlite3
from pathlib import Path

MIGRATIONS = sorted((Path(__file__).resolve().parent.parent / "migrations").glob("*.sql"))
LATEST = int(MIGRATIONS[-1].name.split("_", 1)[0])


def local_server(tmp_path, monkeypatch):
    monkeypatch.setenv("DB_PATH", str(tmp_path / "import.db"))
    import local_server

    return importlib.reload(local_server)


def columns(path, table):
    with sqlite3.connect(path) as conn:
        return {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}


def version(path):
    with sqlite3.connect(path) as conn:
        return conn.execute("PRAGMA user_version").fetchone()[0]


def test_a_local_db_made_before_the_version_was_kept_gains_the_new_migrations(tmp_path, monkeypatch):
    server = local_server(tmp_path, monkeypatch)
    old = tmp_path / "old.db"
    with sqlite3.connect(old) as conn:
        conn.executescript(MIGRATIONS[0].read_text())
        conn.execute("INSERT INTO users (email, created_at_ms) VALUES ('dev@example.com', 1)")
    assert "changed_at_ms" not in columns(old, "open_day_timers")
    server.open_db(old)
    assert "changed_at_ms" in columns(old, "open_day_timers")
    assert version(old) == LATEST
    with sqlite3.connect(old) as conn:
        assert conn.execute("SELECT email FROM users").fetchall() == [("dev@example.com",)]
    server.open_db(old)  # opening it again applies nothing twice
    assert version(old) == LATEST


def test_a_new_local_db_gets_every_migration(tmp_path, monkeypatch):
    server = local_server(tmp_path, monkeypatch)
    new = tmp_path / "new.db"
    server.open_db(new)
    assert "changed_at_ms" in columns(new, "open_day_timers")
    assert version(new) == LATEST
