"""``SqliteD1``: a D1-shaped binding over ``sqlite3``, for the tests and the local server.

The store's SQL is the only SQL in this app; tests and ``local_server.py`` run that same
SQL through this wrapper, so what is tested is what ships. It models the slice of the D1
API the store uses: ``db.prepare(sql).bind(*params)`` with async ``first()`` (a ``dict``
or ``None``), ``all()`` (``.results``, a list of ``dict``) and ``run()``, plus
``db.batch(statements)``, which runs them in one transaction as D1 does ("Batched
statements are SQL transactions"). ``PRAGMA foreign_keys = ON`` matches D1's default.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path
from types import SimpleNamespace


class _Statement:
    def __init__(self, conn: sqlite3.Connection, sql: str, params: tuple = ()):
        self._conn = conn
        self._sql = sql
        self._params = params

    def bind(self, *params) -> "_Statement":
        return _Statement(self._conn, self._sql, params)

    def _execute(self) -> list[dict]:
        cursor = self._conn.execute(self._sql, self._params)
        return [dict(row) for row in cursor.fetchall()]

    async def first(self) -> dict | None:
        rows = self._execute()
        return rows[0] if rows else None

    async def all(self) -> SimpleNamespace:
        return SimpleNamespace(results=self._execute())

    async def run(self) -> SimpleNamespace:
        self._execute()
        return SimpleNamespace(success=True)


class SqliteD1:
    """Wrap a path, ``":memory:"`` or an open connection (switched to autocommit)."""

    def __init__(self, path_or_conn: str | Path | sqlite3.Connection = ":memory:"):
        if isinstance(path_or_conn, sqlite3.Connection):
            self._conn = path_or_conn
        else:
            self._conn = sqlite3.connect(str(path_or_conn))
        self._conn.isolation_level = None
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")

    def prepare(self, sql: str) -> _Statement:
        return _Statement(self._conn, sql)

    async def batch(self, statements) -> list[SimpleNamespace]:
        self._conn.execute("BEGIN")
        try:
            for statement in statements:
                statement._execute()
        except BaseException:
            self._conn.execute("ROLLBACK")
            raise
        self._conn.execute("COMMIT")
        return [SimpleNamespace(success=True) for _ in statements]

    def executescript(self, sql: str) -> None:
        """Apply a migration (not part of the D1 binding)."""
        self._conn.executescript(sql)
