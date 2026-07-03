"""holographic-eye-commands — /holo slash command for The Holographic Eye.

A deliberately tiny companion plugin: the Eye's wrapper is an exclusive
memory plugin, which the general plugin manager does not load, so its
in-session slash command lives here instead (prior art: Ben's command
plugins). Reads the journal/store read-only; never mutates.

NOTE: this file must not mention the memory-provider base-class token,
or the plugin loader's heuristic would route this dir to memory-provider
discovery (see PLAN PART 3 Addendum 2).

Copyright (C) 2026 Ben. GPLv3 — see LICENSE.
"""

from __future__ import annotations

import json
import sqlite3
import urllib.request
from pathlib import Path


def _hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:
        return Path("~/.hermes").expanduser()


def _holo(raw_args: str) -> str:
    home = _hermes_home()
    jpath = home / "eye_journal.db"
    if not jpath.exists():
        return "⊙ The Holographic Eye — no journal yet (provider not active?)"
    j = sqlite3.connect(f"file:{jpath}?mode=ro", uri=True)
    j.row_factory = sqlite3.Row
    m = sqlite3.connect(f"file:{home / 'memory_store.db'}?mode=ro", uri=True)

    n = 5
    arg = (raw_args or "").strip()
    if arg.isdigit():
        n = min(int(arg), 25)

    facts = m.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
    ents = m.execute("SELECT COUNT(*) FROM entities").fetchone()[0]
    events = j.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    lines = [f"⊙ The Holographic Eye — {facts} facts · {ents} entities · "
             f"{events} journal events"]
    # No URL here on purpose: /holo is read on phones (Telegram) where a
    # loopback address is noise — desktop access is `hermes holographic-eye gui`
    try:
        health = json.loads(urllib.request.urlopen(
            "http://127.0.0.1:8770/health", timeout=2).read())
        lines.append("eye: " + ("attached" if health.get("attached")
                                else "up (not attached)"))
    except Exception:
        lines.append("eye: journal-only (control plane down)")
    lines.append(f"— last {n} events —")
    rows = j.execute(
        "SELECT ts, source, kind, duration_ms, undone_by FROM events "
        "ORDER BY event_id DESC LIMIT ?", (n,)).fetchall()
    for r in reversed(rows):
        dur = f" {r['duration_ms']:.0f}ms" if r["duration_ms"] else ""
        undone = " (undone)" if r["undone_by"] else ""
        lines.append(f"{r['ts'][11:19]}  {r['source']}/{r['kind']}{dur}{undone}")
    return "\n".join(lines)


def register(ctx) -> None:
    ctx.register_command(
        "holo", _holo,
        description="The Holographic Eye: memory status + recent journal events",
        args_hint="[n]",
    )
