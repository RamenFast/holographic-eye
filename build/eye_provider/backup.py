"""Backup Memory (D-0007): live-safe snapshots of the memory + journal DBs.

Uses the sqlite3 backup API so snapshots are transactionally consistent
even while the gateway is writing (never a raw file copy of a hot WAL db).
Each backup is a timestamped folder with a manifest. Restore is a
deliberate cold operation (stop gateway → copy back → start) — see PLAN
D-0007.

Copyright (C) 2026 Ben. GPLv3 — see LICENSE.
"""

from __future__ import annotations

import json
import re
import shutil
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

MASS_STORAGE_DEFAULT = Path(
    "/media/ben/Mass storage/agenticTinkering/claude/holographic-eye-backups"
)

# Destinations must live under the user's own trees — guards against typos
# aimed at system paths, not against the authed owner.
_ALLOWED_ROOTS = ("/home/", "/media/")


def _hermes_fallback() -> Path:
    try:
        from hermes_constants import get_hermes_home
        return Path(get_hermes_home()) / "backups" / "holographic-eye"
    except Exception:
        return Path("~/.hermes/backups/holographic-eye").expanduser()


def default_dest() -> Path:
    if MASS_STORAGE_DEFAULT.parent.parent.exists():  # drive mounted
        return MASS_STORAGE_DEFAULT
    return _hermes_fallback()


def known_dests() -> List[Path]:
    return [MASS_STORAGE_DEFAULT, _hermes_fallback()]


def _check_dest(raw: str) -> Path:
    dest = Path(raw).expanduser()
    if not dest.is_absolute() or not str(dest).startswith(_ALLOWED_ROOTS):
        raise ValueError(
            f"destination must be an absolute path under {_ALLOWED_ROOTS}"
        )
    return dest


def _snapshot(src_path: Path, dst_path: Path) -> int:
    src = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True)
    dst = sqlite3.connect(str(dst_path))
    try:
        src.backup(dst)
    finally:
        src.close()
        dst.close()
    return dst_path.stat().st_size


def _snapshot_counts(memory_path: Path, journal_path: Path | None) -> Dict[str, Any]:
    with sqlite3.connect(str(memory_path)) as conn:
        counts = {
            "facts": conn.execute("SELECT COUNT(*) FROM facts").fetchone()[0],
            "entities": conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0],
            "links": conn.execute("SELECT COUNT(*) FROM fact_entities").fetchone()[0],
            "banks": conn.execute("SELECT COUNT(*) FROM memory_banks").fetchone()[0],
        }
    counts["journal_events"] = None
    if journal_path is not None:
        with sqlite3.connect(str(journal_path)) as conn:
            counts["journal_events"] = conn.execute(
                "SELECT COUNT(*) FROM events"
            ).fetchone()[0]
    return counts


def backup_create(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    """Create a process-consistent pair under the provider operation lock.

    SQLite guarantees each file snapshot. The shared wrapper lock prevents
    in-process mutations between the two snapshots. A separate process can
    still write between them; the manifest states that limit explicitly.
    """
    from . import __version__

    store = prov.store
    if store is None:
        return {"ok": False, "error": "memory store unavailable"}
    if prov.journal is None:
        return {"ok": False, "error": "journal unavailable; backup rejected"}
    dest_root = _check_dest(str(params.get("dest_dir") or default_dest()))
    label = re.sub(r"[^A-Za-z0-9_-]+", "-", str(params.get("label", ""))).strip("-")
    label = label[:80]
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    name = f"holo-memory-{stamp}" + (f"-{label}" if label else "")
    folder = dest_root / name
    partial = dest_root / (name + ".partial")

    with prov._operation_lock:
        try:
            partial.mkdir(parents=True, exist_ok=False)
            memory_copy = partial / "memory_store.db"
            journal_copy = partial / "eye_journal.db"
            files = {
                "memory_store.db": _snapshot(Path(store.db_path), memory_copy),
                "eye_journal.db": _snapshot(Path(prov.journal.db_path), journal_copy),
            }
            counts = _snapshot_counts(memory_copy, journal_copy)
            manifest = {
                "created_at": datetime.now(timezone.utc).isoformat(),
                "label": label or None,
                **counts,
                "files": files,
                "consistency": "one in-process mutation boundary; external-process writers are not blocked",
                "restore": "cold restore only: stop gateway, copy the .db files back "
                           "to ~/.hermes/, start gateway (see README)",
                "tool": f"holographic-eye {__version__}",
            }
            (partial / "manifest.json").write_text(json.dumps(manifest, indent=2))
            partial.replace(folder)
        except Exception:
            shutil.rmtree(partial, ignore_errors=True)
            raise

        ev = prov._append(
            "eye", "backup",
            request={k: str(v) for k, v in params.items()},
            response={"path": str(folder), **{k: v for k, v in manifest.items()
                      if k in ("facts", "entities", "journal_events", "files")}},
        )
    if ev is None:
        return {
            "ok": False, "path": str(folder), "manifest": manifest,
            "event_id": None, "committed": True, "journaled": False,
            "error": "backup committed but journal append failed; inspect state before retry",
        }
    return {"ok": True, "path": str(folder), "manifest": manifest,
            "event_id": ev["event_id"]}


def backup_list(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    roots = [_check_dest(params["dest_dir"])] if params.get("dest_dir") else known_dests()
    backups = []
    for root in roots:
        if not root.is_dir():
            continue
        for child in sorted(root.iterdir(), reverse=True):
            mf = child / "manifest.json"
            if child.is_dir() and mf.exists():
                try:
                    manifest = json.loads(mf.read_text())
                except Exception:
                    manifest = {}
                backups.append({
                    "path": str(child),
                    "name": child.name,
                    "created_at": manifest.get("created_at"),
                    "facts": manifest.get("facts"),
                    "journal_events": manifest.get("journal_events"),
                    "bytes": sum(f.stat().st_size for f in child.iterdir()
                                 if f.is_file()),
                })
    return {"ok": True,
            "default_dest": str(default_dest()),
            "known_dests": [str(d) for d in known_dests()],
            "mass_storage_mounted": MASS_STORAGE_DEFAULT.parent.parent.exists(),
            "backups": backups}
