"""Read-path acceleration for the bundled holographic provider.

The inner provider's ``probe()``/``related()``/``reason()`` re-encode
every fact's content vector on every call — ``encode_text`` re-derives
each token atom through 64 SHA-256 blocks, so one probe over ~540 facts
costs ~4 s (measured live 2026-07-07: 4.18 s). The encoders are *pure*:
atoms are SHA-256-derived by construction (PLAN Q2 — verified identical
across processes), so memoizing them returns byte-identical vectors.

This module installs that memoization AT RUNTIME onto the bundled
``holographic`` module from the wrapper — zero file diffs to upstream
(invariant I1 holds), agent-visible results stay bit-identical
(invariant I2 holds: same bytes, sooner). A background thread prewarms
the content-vector cache from a private read-only connection so the
first click is already fast (WAL allows concurrent readers; the live
store connection is never touched — it is not thread-safe to share).

Cached arrays are returned read-only (``setflags(write=False)``) so an
accidental in-place mutation upstream would raise instead of silently
poisoning the cache. Audited 2026-07-07: retrieval.py, store.py and
holographic.py never mutate encoder outputs (bind/unbind/bundle/
similarity are all out-of-place).

Config: ``plugins.holographic-eye.accel: false`` disables everything.

Copyright (C) 2026 Ben. GPLv3 — see LICENSE.
"""

from __future__ import annotations

import functools
import importlib
import logging
import sqlite3
import threading
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# 8 KB per cached vector at dim=1024 (float64). Worst-case footprint:
# 8192 atoms (64 MB) + 4096 texts (32 MB); measured live 2026-07-07 the
# ~540-fact store holds ~6.4k distinct token atoms, so 4096 churned —
# 8192 covers the working set with headroom. Bounded either way.
_ATOM_CACHE_SIZE = 8192
_TEXT_CACHE_SIZE = 4096

_install_lock = threading.Lock()
_state: Dict[str, Any] = {"installed": False, "module": None,
                          "prewarmed": 0, "prewarm_ms": None}


def _readonly(fn, maxsize: int):
    """Memoize a pure encoder; hand out read-only arrays."""

    @functools.lru_cache(maxsize=maxsize)
    def cached(*args, **kwargs):
        arr = fn(*args, **kwargs)
        try:
            arr.setflags(write=False)
        except Exception:
            pass
        return arr

    cached._eye_accel = True  # type: ignore[attr-defined]
    cached._eye_orig = fn     # type: ignore[attr-defined]
    return cached


def install(inner_provider, config: dict) -> bool:
    """Patch the bundled hrr module with memoized encoders. Idempotent,
    never raises — on any failure the provider keeps stock behavior (I7
    spirit: acceleration is a bonus, not a dependency)."""
    if str(config.get("accel", "true")).lower() in ("false", "0", "off", "no"):
        logger.info("Eye accel disabled by config")
        return False
    with _install_lock:
        try:
            pkg = type(inner_provider).__module__
            hrr = importlib.import_module(pkg + ".holographic")
            if not getattr(hrr, "_HAS_NUMPY", False):
                return False
            if getattr(hrr.encode_atom, "_eye_accel", False):
                _state["installed"] = True
                return True  # already installed (e.g. provider re-init)

            hrr.encode_atom = _readonly(hrr.encode_atom, _ATOM_CACHE_SIZE)
            # encode_text resolves `encode_atom` through module globals at
            # call time, so the original body already benefits from the
            # atom cache; wrapping it as well makes repeat probes O(1).
            hrr.encode_text = _readonly(hrr.encode_text, _TEXT_CACHE_SIZE)
            _state["installed"] = True
            _state["module"] = hrr
            logger.info("Eye accel installed (encode_atom/encode_text memoized)")
            return True
        except Exception as e:
            logger.warning("Eye accel unavailable (stock speed): %s", e)
            return False


def prewarm(store, hrr_dim: int) -> None:
    """Fill the content-vector cache in the background so the first
    probe after a gateway restart is already warm. Uses its own
    read-only SQLite connection — never the store's."""
    if not _state["installed"]:
        return
    db_path = str(getattr(store, "db_path", "") or "")
    if not db_path:
        return
    hrr = _state["module"]

    def run() -> None:
        t0 = time.perf_counter()
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True,
                                   timeout=5.0)
            try:
                rows = conn.execute(
                    "SELECT content FROM facts WHERE hrr_vector IS NOT NULL"
                ).fetchall()
            finally:
                conn.close()
            for (content,) in rows:
                hrr.encode_text(content, hrr_dim)
            _state["prewarmed"] = len(rows)
            _state["prewarm_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            logger.info("Eye accel prewarmed %d content vectors in %.0f ms",
                        len(rows), _state["prewarm_ms"])
        except Exception as e:
            logger.debug("Eye accel prewarm skipped: %s", e)

    threading.Thread(target=run, name="eye-accel-prewarm", daemon=True).start()


def stats() -> Optional[Dict[str, Any]]:
    """Cache telemetry for /stats — honesty over mystery."""
    if not _state["installed"] or _state["module"] is None:
        return {"installed": False}
    hrr = _state["module"]
    out: Dict[str, Any] = {
        "installed": True,
        "prewarmed": _state["prewarmed"],
        "prewarm_ms": _state["prewarm_ms"],
    }
    for name in ("encode_atom", "encode_text"):
        try:
            info = getattr(hrr, name).cache_info()
            out[name] = {"hits": info.hits, "misses": info.misses,
                         "size": info.currsize, "max": info.maxsize}
        except Exception:
            pass
    return out
