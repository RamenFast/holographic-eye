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


def backup_create(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    store = prov.store
    dest_root = _check_dest(str(params.get("dest_dir") or default_dest()))
    label = re.sub(r"[^A-Za-z0-9_-]+", "-", str(params.get("label", ""))).strip("-")
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    name = f"holo-memory-{stamp}" + (f"-{label}" if label else "")
    folder = dest_root / name
    folder.mkdir(parents=True, exist_ok=False)

    files: Dict[str, int] = {}
    files["memory_store.db"] = _snapshot(Path(store.db_path),
                                         folder / "memory_store.db")
    if prov.journal is not None:
        files["eye_journal.db"] = _snapshot(Path(prov.journal.db_path),
                                            folder / "eye_journal.db")

    c = store._conn
    manifest = {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "label": label or None,
        "facts": c.execute("SELECT COUNT(*) FROM facts").fetchone()[0],
        "entities": c.execute("SELECT COUNT(*) FROM entities").fetchone()[0],
        "links": c.execute("SELECT COUNT(*) FROM fact_entities").fetchone()[0],
        "banks": c.execute("SELECT COUNT(*) FROM memory_banks").fetchone()[0],
        "journal_events": (prov.journal.stats()["total_events"]
                           if prov.journal else None),
        "files": files,
        "restore": "cold restore only: stop gateway, copy the .db files back "
                   "to ~/.hermes/, start gateway (see README)",
        "tool": "holographic-eye 0.1.0",
    }
    (folder / "manifest.json").write_text(json.dumps(manifest, indent=2))

    ev = prov._append("eye", "backup",
                      request={k: str(v) for k, v in params.items()},
                      response={"path": str(folder), **{k: v for k, v in
                                manifest.items() if k in ("facts", "entities",
                                                          "journal_events", "files")}})
    return {"ok": True, "path": str(folder), "manifest": manifest,
            "event_id": ev["event_id"] if ev else None}


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
