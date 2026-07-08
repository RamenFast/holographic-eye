"""Op journal for The Holographic Eye (C2 in PLAN.md PART 4).

Append-only SQLite event log in $HERMES_HOME/eye_journal.db — a separate
file so memory_store.db keeps zero schema footprint (upstream-compatible).
Every memory mutation, from any source, produces exactly one event with a
complete before/after image (invariant I3); read ops journal request and
the byte-exact response the agent saw.

Journal failures must never break provider delegation (invariant I7):
callers wrap every append in try/except and proceed regardless.

Copyright (C) 2026 Ben. GPLv3 — see LICENSE.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    event_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    ts          TEXT NOT NULL,              -- ISO8601 UTC
    session_id  TEXT DEFAULT '',
    source      TEXT NOT NULL,              -- tool | prefetch | mirror | auto_extract | session | eye | undo
    kind        TEXT NOT NULL,              -- add | search | ... | helpful | initialize | entity_merge | undo
    request     TEXT,                       -- JSON args as received
    response    TEXT,                       -- byte-exact result string (or JSON) returned
    before      TEXT,                       -- JSON prior image: facts + links (+ entities), mutations only
    after       TEXT,                       -- JSON new image
    duration_ms REAL,                       -- inner-call duration (display; not in C2 spec, folded back)
    undone_by   INTEGER                     -- NULL, or event_id of the reverting event
);
CREATE INDEX IF NOT EXISTS idx_events_ts     ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_source ON events(source);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""

_SCHEMA_VERSION = "1"

_EVENT_COLUMNS = (
    "event_id", "ts", "session_id", "source", "kind",
    "request", "response", "before", "after", "duration_ms", "undone_by",
)


def _dump(obj: Any) -> Optional[str]:
    """JSON-encode journal payloads; strings pass through byte-exact."""
    if obj is None:
        return None
    if isinstance(obj, str):
        return obj
    try:
        return json.dumps(obj, ensure_ascii=False, default=str)
    except Exception:
        return json.dumps(str(obj))


class EyeJournal:
    """Append-only event journal with post-commit listener fanout."""

    def __init__(self, db_path: "str | Path"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(
            str(self.db_path), check_same_thread=False, timeout=10.0
        )
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.RLock()
        self._listeners: List[Callable[[Dict[str, Any]], None]] = []
        # incremental retrieval_counts cache — the journal is append-only
        # and responses are immutable (undo appends, never rewrites), so
        # counting only events newer than the last scan is exact
        self._retr_counts: Dict[int, int] = {}
        self._retr_last_id = 0
        with self._lock:
            try:
                self._conn.execute("PRAGMA journal_mode=WAL")
                # NORMAL under WAL: fsync at checkpoint, not per event —
                # cuts append from ~2.5ms to sub-ms. Worst case on power
                # loss is losing the newest events; the DB stays
                # consistent, and this is an observability journal.
                self._conn.execute("PRAGMA synchronous=NORMAL")
            except Exception:
                pass
            self._conn.execute("PRAGMA busy_timeout=10000")
            self._conn.executescript(_SCHEMA)
            self._conn.execute(
                "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)",
                (_SCHEMA_VERSION,),
            )
            self._conn.commit()

    # -- write ---------------------------------------------------------------

    def append(
        self,
        source: str,
        kind: str,
        *,
        request: Any = None,
        response: Any = None,
        before: Any = None,
        after: Any = None,
        session_id: str = "",
        duration_ms: Optional[float] = None,
    ) -> Dict[str, Any]:
        """Insert one event, commit, fan out to listeners. Returns the event."""
        ts = datetime.now(timezone.utc).isoformat()
        row = (
            ts, session_id or "", source, kind,
            _dump(request), _dump(response), _dump(before), _dump(after),
            duration_ms,
        )
        with self._lock:
            cur = self._conn.execute(
                """
                INSERT INTO events
                    (ts, session_id, source, kind, request, response,
                     before, after, duration_ms)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                row,
            )
            self._conn.commit()
            event_id = int(cur.lastrowid)
        event = {
            "event_id": event_id, "ts": ts, "session_id": session_id or "",
            "source": source, "kind": kind,
            "request": row[4], "response": row[5],
            "before": row[6], "after": row[7],
            "duration_ms": duration_ms, "undone_by": None,
        }
        self._fanout(event)
        return event

    def mark_undone(self, event_id: int, undo_event_id: int) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE events SET undone_by = ? WHERE event_id = ?",
                (undo_event_id, event_id),
            )
            self._conn.commit()

    # -- read ----------------------------------------------------------------

    def get_event(self, event_id: int) -> Optional[Dict[str, Any]]:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM events WHERE event_id = ?", (event_id,)
            ).fetchone()
        return dict(zip(_EVENT_COLUMNS, tuple(row))) if row else None

    def get_events(
        self,
        since_id: int = 0,
        limit: int = 200,
        sources: Optional[List[str]] = None,
        newest_first: bool = True,
    ) -> List[Dict[str, Any]]:
        clauses, params = ["event_id > ?"], [since_id]
        if sources:
            clauses.append(
                "source IN (%s)" % ",".join("?" * len(sources))
            )
            params.extend(sources)
        order = "DESC" if newest_first else "ASC"
        params.append(max(1, min(int(limit), 2000)))
        with self._lock:
            rows = self._conn.execute(
                f"SELECT * FROM events WHERE {' AND '.join(clauses)} "
                f"ORDER BY event_id {order} LIMIT ?",
                params,
            ).fetchall()
        return [dict(zip(_EVENT_COLUMNS, tuple(r))) for r in rows]

    def stats(self) -> Dict[str, Any]:
        with self._lock:
            total = self._conn.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            last = self._conn.execute(
                "SELECT event_id, ts FROM events ORDER BY event_id DESC LIMIT 1"
            ).fetchone()
            by_source = self._conn.execute(
                "SELECT source, COUNT(*) c FROM events GROUP BY source"
            ).fetchall()
        return {
            "total_events": total,
            "last_event_id": last[0] if last else 0,
            "last_event_ts": last[1] if last else None,
            "by_source": {r[0]: r[1] for r in by_source},
        }

    def retrieval_counts(self) -> Dict[int, int]:
        """Journal-observed retrieval counts per fact_id.

        The fork's retriever never increments facts.retrieval_count (see
        PLAN PART 3 Addendum 2), so the Eye counts appearances of fact_ids
        in journaled read results + prefetch injections instead.

        Incremental (D-0012): the first call scans history; later calls
        parse only events appended since — this runs on every Inspect
        click and every reprojection, and a week-long journal made the
        full scan the slowest thing in the click path.
        """
        with self._lock:
            rows = self._conn.execute(
                """
                SELECT event_id, response FROM events
                WHERE event_id > ?
                  AND source IN ('tool', 'prefetch')
                  AND kind IN ('search','probe','related','reason','prefetch')
                  AND response IS NOT NULL
                ORDER BY event_id
                """,
                (self._retr_last_id,),
            ).fetchall()
            last = self._conn.execute(
                "SELECT MAX(event_id) FROM events"
            ).fetchone()[0]
            for event_id, resp in rows:
                for fid in _fact_ids_in_response(resp):
                    self._retr_counts[fid] = self._retr_counts.get(fid, 0) + 1
            if last:
                self._retr_last_id = max(self._retr_last_id, int(last))
            return dict(self._retr_counts)

    # -- listeners -----------------------------------------------------------

    def add_listener(self, fn: Callable[[Dict[str, Any]], None]) -> None:
        with self._lock:
            if fn not in self._listeners:
                self._listeners.append(fn)

    def remove_listener(self, fn: Callable[[Dict[str, Any]], None]) -> None:
        with self._lock:
            if fn in self._listeners:
                self._listeners.remove(fn)

    def _fanout(self, event: Dict[str, Any]) -> None:
        for fn in list(self._listeners):
            try:
                fn(event)
            except Exception as e:
                logger.debug("Eye journal listener failed: %s", e)

    def close(self) -> None:
        with self._lock:
            try:
                self._conn.close()
            except Exception:
                pass


def _fact_ids_in_response(resp: str) -> List[int]:
    """Pull fact_ids out of a journaled tool/prefetch response."""
    ids: List[int] = []
    try:
        data = json.loads(resp)
    except Exception:
        return ids
    if isinstance(data, dict):
        items = data.get("results") or data.get("facts") or []
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict) and "fact_id" in item:
                    try:
                        ids.append(int(item["fact_id"]))
                    except (TypeError, ValueError):
                        pass
        for fid in data.get("fact_ids", []) if isinstance(data.get("fact_ids"), list) else []:
            try:
                ids.append(int(fid))
            except (TypeError, ValueError):
                pass
    return ids
