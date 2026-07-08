"""D-0015 acceptance — the control plane boot-warms and survives session churn.

Offline: a wrapped provider on a temp copy of the live DB, control plane on a
test port. Proves the two properties the fix rests on:

  1. A boot-warmed provider (``_eye_boot_warm=True``) attaches as the plane's
     *fallback* (``attach_boot``), not a per-session provider — and :8770
     serves real data with no session ever started.
  2. ``active_provider()`` prefers a live session when attached, but falls
     BACK to the boot provider when that session detaches — so the plane can
     never go dark under the slash_worker turn-routing that caused the
     dormancy (a live session attaches over boot, then ends).

Also spot-checks ``_is_gateway_process()`` — the heuristic whose False result
in ``tui_gateway.slash_worker`` was the root cause.

Run with the hermes venv python (copies the live DB, never touches it):
    ~/.hermes/hermes-agent/venv/bin/python build/verify/test_bootwarm.py

Copyright (C) 2026 Ben. GPLv3 — see LICENSE.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERMES_REPO = Path(os.environ.get("HERMES_REPO", "~/.hermes/hermes-agent")).expanduser()
LIVE_DB = Path("~/.hermes/memory_store.db").expanduser()
EYE_DIR = Path(__file__).resolve().parent.parent / "eye_provider"
PORT = 8781
sys.path.insert(0, str(HERMES_REPO))
os.environ.setdefault("HERMES_HOME", tempfile.mkdtemp(prefix="eye-bw-home-"))

FAIL = 0


def check(label, ok, detail=""):
    global FAIL
    if not ok:
        FAIL += 1
    print(f"[{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def http(path, token=None):
    req = urllib.request.Request(
        f"http://127.0.0.1:{PORT}{path}",
        headers={"Authorization": f"Bearer {token}"} if token else {})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main() -> None:
    spec = importlib.util.spec_from_file_location(
        "holographic_eye_bwtest", str(EYE_DIR / "__init__.py"),
        submodule_search_locations=[str(EYE_DIR)])
    eye = importlib.util.module_from_spec(spec)
    sys.modules["holographic_eye_bwtest"] = eye
    spec.loader.exec_module(eye)

    # the heuristic whose False result in the slash_worker was the root cause
    sys.argv = ["/x/python", "gateway", "run"]
    check("gateway argv → is_gateway True", eye._is_gateway_process() is True)
    sys.argv = ["/x/tui_gateway/slash_worker.py", "--session-key", "s", "--model", "m"]
    check("slash_worker argv → is_gateway False (the dormancy cause)",
          eye._is_gateway_process() is False)

    from plugins.memory.holographic import HolographicMemoryProvider
    tmp = Path(tempfile.mkdtemp(prefix="eye-bw-"))
    db = tmp / "eye.db"
    src = sqlite3.connect(f"file:{LIVE_DB}?mode=ro", uri=True)
    dst = sqlite3.connect(str(db))
    src.backup(dst); src.close(); dst.close()
    cfg = {"journal_path": str(tmp / "journal.db"), "mode": "journal",
           "control_plane": "always", "port": PORT}

    # (1) boot-warm attaches as the plane's fallback, not a session
    boot = eye.EyeMemoryProvider(config=cfg,
                                 inner=HolographicMemoryProvider(config={"db_path": str(db)}))
    boot.initialize("__eye_boot__", platform="gateway-boot", _eye_boot_warm=True)
    time.sleep(0.2)
    plane = boot._control
    check("boot-warm bound the plane", plane is not None)
    check("boot attached as fallback (plane.provider is None)",
          plane is not None and plane.provider is None)
    check("plane._boot_provider is the boot provider", plane._boot_provider is boot)
    check("active_provider() falls back to boot", plane.active_provider() is boot)
    st, health = http("/health")
    check("/health attached:true from boot provider alone",
          st == 200 and health.get("attached") is True, str(health))
    st, stats = http("/stats", plane.token)
    check("/stats serves real data via boot provider",
          st == 200 and stats.get("facts", 0) > 0,
          f"{stats.get('facts')} facts, session={stats.get('session_id')}")

    # (2) session churn: live provider attaches over boot, then detaches —
    #     the plane must fall back and never go dark
    sess = eye.EyeMemoryProvider(config=cfg,
                                 inner=HolographicMemoryProvider(config={"db_path": str(db)}))
    sess.initialize("live-session-42")
    check("live session attaches over boot", plane.provider is sess)
    check("active_provider() prefers live session", plane.active_provider() is sess)
    sess.shutdown()
    check("after session detach, plane.provider is None", plane.provider is None)
    check("active_provider() falls BACK to boot (survives churn)",
          plane.active_provider() is boot)
    st, health = http("/health")
    check("/health STILL attached:true after session gone",
          st == 200 and health.get("attached") is True, str(health))
    st, stats = http("/stats", plane.token)
    check("/stats STILL serves data after session gone",
          st == 200 and stats.get("facts", 0) > 0)

    boot.shutdown()


if __name__ == "__main__":
    main()
    print("\n" + ("ALL CHECKS PASSED" if FAIL == 0 else f"{FAIL} CHECK(S) FAILED"))
    sys.exit(1 if FAIL else 0)
