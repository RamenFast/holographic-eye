"""holographic-eye — wrapper MemoryProvider for The Holographic Eye.

Wraps the bundled ``holographic`` provider (unmodified, C1 in PLAN.md
PART 4): delegates every MemoryProvider method to it, journals every
memory op to $HERMES_HOME/eye_journal.db with full before/after images
(C2), and hosts the loopback control plane the Eye GUI talks to (C4).

Invariants honored here:
  I1  zero diffs to Hermes core / the bundled plugin (pure composition)
  I2  mode=journal: agent-visible behavior is bit-identical to stock —
      every return value is the delegate's return value, untouched
  I3  every mutation → exactly one journal event with before/after images
  I7  journal/control-plane failure degrades to stock behavior; delegation
      is never blocked by Eye machinery

Activate via config.yaml:  memory.provider: holographic-eye
Config under plugins.holographic-eye: mode (journal), port (8770).

Copyright (C) 2026 Ben. GPLv3 — see LICENSE.
"""

from __future__ import annotations

import json
import logging
import threading
import time
from typing import Any, Dict, List, Optional

from agent.memory_provider import MemoryProvider

from . import images
from .journal import EyeJournal

logger = logging.getLogger(__name__)

__version__ = "1.0.1"

_MUTATING_FACT_ACTIONS = {"add", "update", "remove"}
_READ_FACT_ACTIONS = {"search", "probe", "related", "reason", "contradict", "list"}


def _is_gateway_process() -> bool:
    """True only in the always-on gateway (`hermes gateway run` /
    the systemd unit) — the one process that owns port 8770."""
    try:
        import sys
        return "gateway" in [a.lower() for a in sys.argv]
    except Exception:
        return False


def _load_eye_config() -> dict:
    try:
        from hermes_constants import get_hermes_home
        from hermes_cli.config import cfg_get
        import yaml
        config_path = get_hermes_home() / "config.yaml"
        if not config_path.exists():
            return {}
        with open(config_path, encoding="utf-8-sig") as f:
            all_config = yaml.safe_load(f) or {}
        return cfg_get(all_config, "plugins", "holographic-eye", default={}) or {}
    except Exception:
        return {}


class EyeMemoryProvider(MemoryProvider):
    """Journaling wrapper around the bundled HolographicMemoryProvider."""

    def __init__(self, config: dict | None = None, inner: MemoryProvider | None = None):
        self._config = config if config is not None else _load_eye_config()
        self._mode = str(self._config.get("mode", "journal"))
        self._session_id = ""
        self._journal: Optional[EyeJournal] = None
        self._control = None
        if inner is not None:
            self._inner = inner
        else:
            from plugins.memory import load_memory_provider
            self._inner = load_memory_provider("holographic")

    # -- identity ------------------------------------------------------------

    @property
    def name(self) -> str:
        return "holographic-eye"

    def is_available(self) -> bool:
        return self._inner is not None and self._inner.is_available()

    # -- store access (wrapper-privileged, used by journal capture + RPC) ----

    @property
    def store(self):
        return getattr(self._inner, "_store", None)

    @property
    def retriever(self):
        return getattr(self._inner, "_retriever", None)

    @property
    def journal(self) -> Optional[EyeJournal]:
        return self._journal

    # -- lifecycle -----------------------------------------------------------

    def initialize(self, session_id: str, **kwargs) -> None:
        self._inner.initialize(session_id, **kwargs)
        self._session_id = session_id
        # read-path acceleration (D-0012): memoize the bundled encoders —
        # zero upstream diffs (I1), byte-identical results (I2), probe
        # drops from ~4 s to ~ms; prewarm runs off the critical path
        try:
            from . import accel
            if accel.install(self._inner, self._config) and self.store is not None:
                accel.prewarm(self.store,
                              getattr(self.store, "hrr_dim", 1024))
        except Exception as e:
            logger.debug("Eye accel skipped: %s", e)
        try:
            from hermes_constants import get_hermes_home
            journal_path = str(self._config.get(
                "journal_path", get_hermes_home() / "eye_journal.db"
            ))
            if self._journal is None:
                self._journal = EyeJournal(journal_path)
            self._journal.append(
                "session", "initialize",
                request={
                    "platform": kwargs.get("platform", ""),
                    "agent_context": kwargs.get("agent_context", ""),
                    "mode": self._mode,
                },
                session_id=session_id,
            )
        except Exception as e:
            logger.warning("Eye journal unavailable (degrading to stock): %s", e)
            self._journal = None
        # The control plane belongs to the always-on gateway. Every other
        # hermes process — chat CLI, `hermes dashboard`, `memory status`
        # probes — must not steal port 8770 and die (or linger) with it.
        # The old platform=="cli" test missed the dashboard (2026-07-07:
        # a long-lived dashboard held 8770 across a gateway upgrade), so
        # auto now keys on the process itself: only `... gateway run`
        # hosts the plane. control_plane: always|never still overrides.
        cp_policy = str(self._config.get("control_plane", "auto"))
        skip_cp = (
            cp_policy == "never"
            or (cp_policy == "auto" and not _is_gateway_process())
        )
        if skip_cp:
            self._control = None
        else:
            try:
                from .control import ensure_control_plane
                self._control = ensure_control_plane(self)
            except Exception as e:
                logger.warning("Eye control plane unavailable (journal-only): %s", e)
                self._control = None

    def shutdown(self) -> None:
        self._append("session", "shutdown", request={})
        try:
            if self._control is not None:
                self._control.detach(self)
        except Exception:
            pass
        try:
            if self._journal is not None:
                self._journal.close()
        except Exception:
            pass
        self._journal = None
        self._inner.shutdown()

    # -- pure delegation (I2) --------------------------------------------------

    def system_prompt_block(self) -> str:
        return self._inner.system_prompt_block()

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return self._inner.get_tool_schemas()

    def get_config_schema(self) -> List[Dict[str, Any]]:
        return self._inner.get_config_schema()

    def save_config(self, values: Dict[str, Any], hermes_home: str) -> None:
        self._inner.save_config(values, hermes_home)

    def backup_paths(self) -> List[str]:
        return self._inner.backup_paths()

    def queue_prefetch(self, query: str, *, session_id: str = "") -> None:
        self._inner.queue_prefetch(query, session_id=session_id)

    def sync_turn(self, user_content: str, assistant_content: str, *,
                  session_id: str = "", messages=None) -> None:
        self._inner.sync_turn(user_content, assistant_content, session_id=session_id)

    def on_turn_start(self, turn_number: int, message: str, **kwargs) -> None:
        self._inner.on_turn_start(turn_number, message, **kwargs)

    def on_pre_compress(self, messages: List[Dict[str, Any]]) -> str:
        return self._inner.on_pre_compress(messages)

    def on_delegation(self, task: str, result: str, *,
                      child_session_id: str = "", **kwargs) -> None:
        self._inner.on_delegation(
            task, result, child_session_id=child_session_id, **kwargs
        )

    # -- journaled interception points ----------------------------------------

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        t0 = time.perf_counter()
        block = self._inner.prefetch(query, session_id=session_id)
        duration = (time.perf_counter() - t0) * 1000.0
        # journaling (incl. the fact-id resolving search) runs off the
        # critical path — the turn pays ~0ms for the Eye here
        try:
            threading.Thread(
                target=self._journal_prefetch,
                args=(query, block, session_id or self._session_id, duration),
                name="eye-prefetch-journal", daemon=True,
            ).start()
        except Exception as e:
            logger.debug("Eye prefetch journaling failed: %s", e)
        return block

    def _journal_prefetch(self, query: str, block: str,
                          session_id: str, duration: float) -> None:
        try:
            fact_ids: List[int] = []
            if block and self.retriever is not None:
                min_trust = getattr(self._inner, "_min_trust", 0.3)
                results = self.retriever.search(query, min_trust=min_trust, limit=5)
                fact_ids = [int(r["fact_id"]) for r in results if "fact_id" in r]
            self._append(
                "prefetch", "prefetch",
                request={"query": query},
                response={"block": block, "fact_ids": fact_ids,
                          "chars": len(block or "")},
                session_id=session_id,
                duration_ms=duration,
            )
        except Exception as e:
            logger.debug("Eye prefetch journaling failed: %s", e)

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs) -> str:
        before = self._capture_before(tool_name, args)
        marks = self._safe_marks()
        t0 = time.perf_counter()
        result = self._inner.handle_tool_call(tool_name, args, **kwargs)
        duration = (time.perf_counter() - t0) * 1000.0
        try:
            self._journal_tool_call(tool_name, args, result, before, marks, duration)
        except Exception as e:
            logger.debug("Eye tool-call journaling failed: %s", e)
        return result

    def on_memory_write(self, action: str, target: str, content: str,
                        metadata: Optional[Dict[str, Any]] = None) -> None:
        marks = self._safe_marks()
        self._inner.on_memory_write(action, target, content)
        try:
            after = (
                images.created_since(self.store, marks)
                if marks and self.store else None
            )
            self._append(
                "mirror", action or "add",
                request={"action": action, "target": target, "content": content,
                         "metadata": metadata or {}},
                after=after,
            )
        except Exception as e:
            logger.debug("Eye mirror journaling failed: %s", e)

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        marks = self._safe_marks()
        self._inner.on_session_end(messages)
        try:
            after = (
                images.created_since(self.store, marks)
                if marks and self.store else None
            )
            n_new = len(after["facts"]) if after else 0
            self._append(
                "auto_extract", "extract",
                request={"message_count": len(messages or [])},
                after=after,
                response={"facts_extracted": n_new},
            )
        except Exception as e:
            logger.debug("Eye auto-extract journaling failed: %s", e)

    def on_session_switch(self, new_session_id: str, *, parent_session_id: str = "",
                          reset: bool = False, rewound: bool = False, **kwargs) -> None:
        self._inner.on_session_switch(
            new_session_id, parent_session_id=parent_session_id,
            reset=reset, rewound=rewound, **kwargs
        )
        old = self._session_id
        self._session_id = new_session_id
        self._append(
            "session", "session_switch",
            request={"from": old, "to": new_session_id,
                     "parent": parent_session_id, "reset": reset, "rewound": rewound},
            session_id=new_session_id,
        )

    # -- capture helpers -------------------------------------------------------

    def _append(self, source: str, kind: str, **kw) -> Optional[Dict[str, Any]]:
        """Journal write that can never break delegation (I7)."""
        if self._journal is None:
            return None
        kw.setdefault("session_id", self._session_id)
        try:
            return self._journal.append(source, kind, **kw)
        except Exception as e:
            logger.debug("Eye journal append failed: %s", e)
            return None

    def _safe_marks(self) -> Optional[Dict[str, int]]:
        try:
            if self.store is not None and self._journal is not None:
                return images.max_ids(self.store)
        except Exception:
            pass
        return None

    def _capture_before(self, tool_name: str, args: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Before-image for mutating ops; None for reads / on any failure."""
        if self._journal is None or self.store is None:
            return None
        try:
            if tool_name == "fact_store":
                action = args.get("action")
                if action == "add":
                    img = images.fact_image_by_content(self.store, args.get("content", "") or "")
                    return {"facts": [img]} if img else {"facts": []}
                if action in ("update", "remove") and "fact_id" in args:
                    img = images.fact_image(self.store, int(args["fact_id"]))
                    return {"facts": [img] if img else []}
            elif tool_name == "fact_feedback" and "fact_id" in args:
                img = images.fact_image(self.store, int(args["fact_id"]))
                return {"facts": [img] if img else []}
        except Exception as e:
            logger.debug("Eye before-capture failed: %s", e)
        return None

    def _journal_tool_call(
        self,
        tool_name: str,
        args: Dict[str, Any],
        result: str,
        before: Optional[Dict[str, Any]],
        marks: Optional[Dict[str, int]],
        duration_ms: float,
    ) -> None:
        if self._journal is None:
            return
        if tool_name == "fact_feedback":
            kind = args.get("action", "feedback")
            after = None
            if self.store is not None and "fact_id" in args:
                img = images.fact_image(self.store, int(args["fact_id"]))
                after = {"facts": [img] if img else []}
            self._append("tool", kind, request=args, response=result,
                         before=before, after=after, duration_ms=duration_ms)
            return

        action = args.get("action", "unknown")
        after = None
        if action in _MUTATING_FACT_ACTIONS and self.store is not None:
            try:
                fact_id = None
                if action == "add":
                    parsed = json.loads(result)
                    fact_id = parsed.get("fact_id")
                elif "fact_id" in args:
                    fact_id = int(args["fact_id"])
                fact_after = (
                    images.fact_image(self.store, int(fact_id))
                    if fact_id is not None else None
                )
                after = {"facts": [fact_after] if fact_after else []}
                if marks:
                    created = images.created_since(self.store, marks)
                    if created["entities_created"]:
                        after["entities_created"] = created["entities_created"]
            except Exception as e:
                logger.debug("Eye after-capture failed: %s", e)
        self._append(
            "tool", action, request=args, response=result,
            before=before if action in _MUTATING_FACT_ACTIONS else None,
            after=after, duration_ms=duration_ms,
        )


def register(ctx) -> None:
    """Register the Eye wrapper provider (cheap: no journal/server here —
    discovery calls this on every scan, see PLAN PART 3 Addendum 2)."""
    ctx.register_memory_provider(EyeMemoryProvider())
