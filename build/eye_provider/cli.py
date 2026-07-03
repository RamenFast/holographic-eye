"""``hermes holographic-eye`` — terminal window into the Eye (P7).

Registered via the active-memory-plugin CLI path
(plugins/memory/__init__.py:discover_plugin_cli_commands). The command
name is fixed to the provider directory name by that contract, so the
PLAN's ``hermes holo`` became ``hermes holographic-eye`` (folded back).

Subcommands read the journal directly (read-only, WAL-safe) so they work
even when the control plane is down; mutations go through the control
plane so they're journaled + undoable like every other Eye write.

Copyright (C) 2026 Ben. GPLv3 — see LICENSE.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import urllib.request
from pathlib import Path

# Blossom-shell flavored output (nicety, not a contract — PLAN PART 2)
PINK = "\033[38;2;219;55;118m"
GOLD = "\033[38;2;241;191;64m"
DIM = "\033[38;2;159;179;194m"
RED = "\033[38;2;236;78;83m"
RST = "\033[0m"


def _hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home())
    except Exception:
        return Path("~/.hermes").expanduser()


def _journal():
    path = _hermes_home() / "eye_journal.db"
    if not path.exists():
        raise SystemExit(f"{RED}no journal at {path} — is the Eye deployed?{RST}")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _rpc(method: str, params: dict) -> dict:
    token = (_hermes_home() / "eye_token").read_text().strip()
    req = urllib.request.Request(
        "http://127.0.0.1:8770/rpc", method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {token}"},
        data=json.dumps({"method": method, "params": params}).encode(),
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def register_cli(subparser: argparse.ArgumentParser) -> None:
    subs = subparser.add_subparsers(dest="eye_command")
    subs.add_parser("status", help="Journal + store health at a glance")
    tail_p = subs.add_parser("tail", help="Print recent journal events")
    tail_p.add_argument("-n", type=int, default=20)
    tail_p.add_argument("--source", default=None,
                        help="filter: tool|prefetch|mirror|auto_extract|eye|undo")
    subs.add_parser("undo-last", help="Undo the most recent journaled mutation")
    bk_p = subs.add_parser("backup", help="Backup memory (D-0007)")
    bk_p.add_argument("--dest", default=None)
    bk_p.add_argument("--label", default="")
    subs.add_parser("gui", help="Print the GUI URL (with token) and try to open it")


def _status() -> None:
    j = _journal()
    total = j.execute("SELECT COUNT(*) FROM events").fetchone()[0]
    last = j.execute(
        "SELECT ts, source, kind FROM events ORDER BY event_id DESC LIMIT 1"
    ).fetchone()
    by = j.execute("SELECT source, COUNT(*) c FROM events GROUP BY source").fetchall()
    mem = _hermes_home() / "memory_store.db"
    m = sqlite3.connect(f"file:{mem}?mode=ro", uri=True)
    facts = m.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
    ents = m.execute("SELECT COUNT(*) FROM entities").fetchone()[0]
    print(f"{PINK}⊙ The Holographic Eye{RST}")
    print(f"  facts {GOLD}{facts}{RST} · entities {GOLD}{ents}{RST} · "
          f"journal events {GOLD}{total}{RST}")
    print("  " + " · ".join(f"{r['source']} {GOLD}{r['c']}{RST}" for r in by))
    if last:
        print(f"  last event {DIM}{last['ts']}{RST} {last['source']}/{last['kind']}")
    try:
        health = json.loads(urllib.request.urlopen(
            "http://127.0.0.1:8770/health", timeout=2).read())
        state = ("attached" if health.get("attached") else "up, not attached")
        print(f"  control plane {GOLD}{state}{RST} · http://127.0.0.1:8770")
    except Exception:
        print(f"  control plane {DIM}down (journal-only){RST}")


def _tail(n: int, source: str | None) -> None:
    j = _journal()
    where, params = "", []
    if source:
        where, params = "WHERE source = ?", [source]
    rows = j.execute(
        f"SELECT * FROM events {where} ORDER BY event_id DESC LIMIT ?",
        params + [n],
    ).fetchall()
    for r in reversed(rows):
        ts = r["ts"][11:19]
        dur = f"{r['duration_ms']:.0f}ms" if r["duration_ms"] else ""
        undone = f" {RED}undone{RST}" if r["undone_by"] else ""
        req = (r["request"] or "")[:70].replace("\n", " ")
        print(f"{DIM}{ts}{RST} {PINK}{r['source']:>12}{RST}/{r['kind']:<14} "
              f"{DIM}{req}{RST} {GOLD}{dur}{RST}{undone}")


def _undo_last() -> None:
    j = _journal()
    row = j.execute(
        """SELECT event_id, source, kind, request FROM events
           WHERE undone_by IS NULL AND source != 'undo'
             AND kind IN ('add','update','remove','helpful','unhelpful','extract',
                          'fact.add','fact.update','fact.remove','fact.trust_set',
                          'entity.merge','entity.alias','entity.remove')
           ORDER BY event_id DESC LIMIT 1"""
    ).fetchone()
    if not row:
        raise SystemExit(f"{DIM}nothing undoable in the journal{RST}")
    print(f"undoing event {GOLD}#{row['event_id']}{RST} "
          f"({row['source']}/{row['kind']}) …")
    res = _rpc("undo", {"event_id": row["event_id"]})
    if res.get("ok"):
        print(f"{PINK}↶ restored{RST} (undo event #{res['event_id']})")
    else:
        raise SystemExit(f"{RED}{res.get('error')}{RST}")


def _backup(dest: str | None, label: str) -> None:
    params: dict = {"label": label}
    if dest:
        params["dest_dir"] = dest
    res = _rpc("backup.create", params)
    if res.get("ok"):
        m = res["manifest"]
        print(f"{PINK}✓ backed up{RST} {GOLD}{m['facts']}{RST} facts + "
              f"{GOLD}{m['journal_events']}{RST} journal events")
        print(f"  → {res['path']}")
    else:
        raise SystemExit(f"{RED}{res.get('error')}{RST}")


def _gui() -> None:
    token = (_hermes_home() / "eye_token").read_text().strip()
    url = f"http://127.0.0.1:8770/?token={token}"
    print(url)
    import shutil, subprocess
    for browser in ("xdg-open", "thorium-browser"):
        if shutil.which(browser):
            subprocess.Popen([browser, url], stdout=subprocess.DEVNULL,
                             stderr=subprocess.DEVNULL)
            break


def _command(args: argparse.Namespace) -> None:
    cmd = getattr(args, "eye_command", None)
    if cmd == "status" or cmd is None:
        _status()
    elif cmd == "tail":
        _tail(args.n, args.source)
    elif cmd == "undo-last":
        _undo_last()
    elif cmd == "backup":
        _backup(args.dest, args.label)
    elif cmd == "gui":
        _gui()


# the discovery contract looks up "<provider-dir-name>_command"; the dir name
# contains a dash, so the handler is bound via globals()
globals()["holographic-eye_command"] = _command
