"""RPC dispatch for the Eye control plane (C4 method surface, PLAN PART 4).

Read passthroughs call the *inner* provider's own handle_tool_call and
return its byte-exact string (invariant I6); GUI reads are not journaled
(I3 covers mutations). Mutations live in mutations.py (journaled,
source=eye, undoable); explain/projection reads live in explain.py.

Copyright (C) 2026 Ben. GPLv3 — see LICENSE.
"""

from __future__ import annotations

import json
import math
import sqlite3
from numbers import Real
from typing import Any, Dict, Optional

from . import images

_PASSTHROUGH_ACTIONS = {"search", "probe", "related", "reason", "contradict", "list"}
_MUTATION_METHODS = {
    "fact.add", "fact.update", "fact.remove", "fact.trust_set", "fact.feedback",
    "entity.merge", "entity.alias", "entity.remove", "undo", "backfill_vectors",
}


def _positive_int(params: Dict[str, Any], key: str) -> Optional[str]:
    value = params.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
        return f"{key} must be a positive integer"
    return None


def _nonnegative_int(params: Dict[str, Any], key: str) -> Optional[str]:
    value = params.get(key)
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        return f"{key} must be a non-negative integer"
    return None


def _finite_real(params: Dict[str, Any], key: str) -> Optional[str]:
    value = params.get(key)
    if not isinstance(value, Real) or isinstance(value, bool) or not math.isfinite(float(value)):
        return f"{key} must be a finite number"
    return None


def _string(params: Dict[str, Any], key: str, *, nonempty: bool = False) -> Optional[str]:
    value = params.get(key)
    if not isinstance(value, str):
        return f"{key} must be a string"
    if nonempty and not value.strip():
        return f"{key} must not be empty"
    return None


def _string_list(params: Dict[str, Any], key: str, *, nonempty: bool = False) -> Optional[str]:
    value = params.get(key)
    if not isinstance(value, list) or any(not isinstance(item, str) or not item for item in value):
        return f"{key} must be a list of strings"
    if nonempty and not value:
        return f"{key} must not be empty"
    return None


def _validate_params(method: str, params: Dict[str, Any]) -> Optional[str]:
    if method in _PASSTHROUGH_ACTIONS:
        if method == "search" and (error := _string(params, "query", nonempty=True)):
            return error
        if method in ("probe", "related") and (
            error := _string(params, "entity", nonempty=True)
        ):
            return error
        if method == "reason" and (
            error := _string_list(params, "entities", nonempty=True)
        ):
            return error
        if "category" in params and (
            error := _string(params, "category", nonempty=True)
        ):
            return error
        if "limit" in params and (error := _positive_int(params, "limit")):
            return error
        if "min_trust" in params and (error := _finite_real(params, "min_trust")):
            return error
    if method in ("fact.get", "fact.remove", "fact.trust_set", "fact.feedback",
                  "fact.preview_update", "fact.update"):
        if error := _positive_int(params, "fact_id"):
            return error
    if method == "fact.get" and "include_vector" in params and not isinstance(
        params["include_vector"], bool
    ):
        return "include_vector must be a boolean"
    if method == "fact.add":
        if error := _string(params, "content", nonempty=True):
            return error
        for key in ("category", "tags"):
            if key in params and (error := _string(
                params, key, nonempty=(key == "category")
            )):
                return error
    if method == "fact.update":
        fields = {"content", "trust_delta", "tags", "category"} & params.keys()
        if not fields:
            return "fact.update requires content, trust_delta, tags, or category"
        if "content" in params and (error := _string(params, "content", nonempty=True)):
            return error
        if "trust_delta" in params and (error := _finite_real(params, "trust_delta")):
            return error
        for key in ("tags", "category"):
            if key in params and (error := _string(
                params, key, nonempty=(key == "category")
            )):
                return error
    if method == "fact.preview_update":
        fields = {"content", "tags", "category"} & params.keys()
        if not fields:
            return "fact.preview_update requires content, tags, or category"
        if "content" in params and (error := _string(params, "content", nonempty=True)):
            return error
        for key in ("tags", "category"):
            if key in params and (error := _string(
                params, key, nonempty=(key == "category")
            )):
                return error
    if method == "fact.trust_set" and (error := _finite_real(params, "trust")):
        return error
    if method == "fact.feedback" and not isinstance(params.get("helpful"), bool):
        return "helpful must be a boolean"
    if method == "entity.merge":
        return _positive_int(params, "src_id") or _positive_int(params, "dst_id")
    if method in ("entity.alias", "entity.remove"):
        if error := _positive_int(params, "entity_id"):
            return error
    if method == "entity.alias":
        fields = {"name", "aliases", "entity_type"} & params.keys()
        if not fields:
            return "entity.alias requires name, aliases, or entity_type"
        for key in fields:
            if error := _string(params, key, nonempty=(key in ("name", "entity_type"))):
                return error
    if method in ("undo", "journal.get"):
        return _positive_int(params, "event_id")
    if method == "entity.get":
        if "entity_id" in params:
            return _positive_int(params, "entity_id")
        return _string(params, "name", nonempty=True)
    if method == "journal.tail":
        if "since_id" in params and (error := _nonnegative_int(params, "since_id")):
            return error
        if "limit" in params and (error := _positive_int(params, "limit")):
            return error
        if "sources" in params and (error := _string_list(params, "sources")):
            return error
        if "newest_first" in params and not isinstance(params["newest_first"], bool):
            return "newest_first must be a boolean"
    if method == "entities.list":
        if "q" in params and (error := _string(params, "q")):
            return error
        if "limit" in params and (error := _positive_int(params, "limit")):
            return error
        if "offset" in params and (error := _nonnegative_int(params, "offset")):
            return error
    if method == "reason.explain":
        if error := _string_list(params, "entities", nonempty=True):
            return error
        if "category" in params and (error := _string(params, "category", nonempty=True)):
            return error
        if "limit" in params and (error := _positive_int(params, "limit")):
            return error
    if method == "fact.spectrum":
        if not ({"fact_id", "entities", "banks"} & params.keys()):
            return "fact.spectrum requires fact_id, entities, or banks"
        if "fact_id" in params and (error := _positive_int(params, "fact_id")):
            return error
        for key in ("entities", "banks"):
            if key in params and (error := _string_list(params, key)):
                return error
    if method == "field.projection" and "refit" in params and not isinstance(params["refit"], bool):
        return "refit must be a boolean"
    if method == "agent.ask":
        if error := _string(params, "prompt", nonempty=True):
            return error
        if "session_id" in params and (error := _string(params, "session_id", nonempty=True)):
            return error
        if "fact_ids" in params:
            fact_ids = params["fact_ids"]
            if (not isinstance(fact_ids, list)
                    or any(not isinstance(value, int) or isinstance(value, bool) or value <= 0
                           for value in fact_ids)):
                return "fact_ids must be a list of positive integers"
    if method == "backup.create":
        for key in ("dest_dir", "label"):
            if key in params and (error := _string(params, key)):
                return error
    if method == "backup.list" and "dest_dir" in params:
        return _string(params, "dest_dir")
    return None


def dispatch(plane, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(method, str) or not method:
        return {"ok": False, "error": "method required"}
    if not isinstance(params, dict):
        return {"ok": False, "error": "params must be an object", "method": method}
    if error := _validate_params(method, params):
        return {"ok": False, "error": error, "method": method}
    try:
        return _dispatch(plane, method, params)
    except (AttributeError, KeyError, TypeError, ValueError, OverflowError) as exc:
        return {"ok": False, "error": f"invalid parameters: {exc}", "method": method}
    except sqlite3.Error as exc:
        return {"ok": False, "error": f"database operation failed: {exc}", "method": method}


def _journal_ready(prov) -> bool:
    if prov.journal is None:
        return False
    try:
        prov.journal.stats()
        return True
    except Exception:
        return False


def _dispatch(plane, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
    prov = plane.active_provider()
    if prov is None:
        return {"error": "no provider attached"}

    # -- agent-fidelity read passthrough (I6) --------------------------------
    if method in _PASSTHROUGH_ACTIONS:
        args = dict(params)
        args["action"] = method
        raw = prov._inner.handle_tool_call("fact_store", args)
        return {"ok": True, "raw": raw}

    # -- journal reads ---------------------------------------------------------
    if method == "journal.tail":
        j = _journal(prov)
        return {"ok": True, "events": j.get_events(
            since_id=int(params.get("since_id", 0)),
            limit=int(params.get("limit", 200)),
            sources=params.get("sources"),
            newest_first=bool(params.get("newest_first", True)),
        )}
    if method == "journal.get":
        j = _journal(prov)
        ev = j.get_event(int(params["event_id"]))
        return {"ok": ev is not None, "event": ev}
    if method == "journal.stats":
        return {"ok": True, "stats": _journal(prov).stats()}
    if method == "journal.retrievals":
        return {"ok": True, "counts": _journal(prov).retrieval_counts()}
    if method == "stats":
        return {"ok": True, "stats": plane.stats()}

    # -- structured reads for the panes ------------------------------------------
    if method == "fact.get":
        return _fact_get(prov, params)
    if method == "entities.list":
        return _entities_list(prov, params)
    if method == "entity.get":
        return _entity_get(prov, params)

    # -- explain reads (same code paths, intermediates exposed) -------------------
    if method in ("field.projection", "reason.explain", "fact.spectrum"):
        from . import explain
        fn = {
            "field.projection": explain.field_projection,
            "reason.explain": explain.reason_explain,
            "fact.spectrum": explain.fact_spectrum,
        }[method]
        return fn(prov, params)

    # -- ask the agent (P6, C6) -------------------------------------------------------
    if method == "agent.ask":
        if not _journal_ready(prov):
            return {"ok": False, "error": "journal unavailable; request rejected"}
        return _agent_ask(prov, params)
    if method == "agent.sessions":
        return _agent_sessions(prov, params)

    # -- backup memory (D-0007) -----------------------------------------------------
    if method == "backup.create":
        from . import backup
        with prov._operation_lock:
            return backup.backup_create(prov, params)
    if method == "backup.list":
        from . import backup
        return backup.backup_list(prov, params)

    # -- previews + mutations (journaled, source=eye) ------------------------------
    if method == "fact.preview_update":
        from . import mutations
        return mutations.dispatch(prov, method, params)
    if method in _MUTATION_METHODS:
        if not _journal_ready(prov):
            return {"ok": False, "error": "journal unavailable; mutation rejected"}
        from . import mutations
        with prov._operation_lock:
            return mutations.dispatch(prov, method, params)

    return {"ok": False, "error": f"unknown method: {method}"}


def _journal(prov):
    if prov.journal is None:
        raise RuntimeError("journal unavailable")
    return prov.journal


def _api_server_key() -> str:
    import os
    key = os.getenv("API_SERVER_KEY", "")
    if key:
        return key
    try:  # gateway may not export it; fall back to the .env file
        from hermes_constants import get_hermes_home
        for line in (get_hermes_home() / ".env").read_text().splitlines():
            if line.strip().startswith("API_SERVER_KEY="):
                return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return ""


def _agent_ask(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    """C6: inject a curation request into a live agent turn via the
    api_server platform (loopback, Q4-verified). The agent's resulting
    fact_store mutations land in the journal as ordinary tool events,
    visible in the Stream/Queue seconds later.

    Session targeting (Ben, feedback round 1): by default every ask lands
    in ONE stable named session ("eye-console") via X-Hermes-Session-Id,
    instead of spawning anonymous api-* sessions; pass session_id to
    target any existing session from agent.sessions. The session the
    server actually used is echoed back in the response header and
    reported to the caller."""
    import urllib.request
    prompt = str(params.get("prompt", "")).strip()
    if not prompt:
        return {"ok": False, "error": "prompt required"}
    key = _api_server_key()
    if not key:
        return {"ok": False, "error": "API_SERVER_KEY not configured — "
                                      "use copy-prompt fallback"}
    target = str(params.get("session_id") or "eye-console").strip()
    req = urllib.request.Request(
        "http://127.0.0.1:8642/v1/chat/completions",
        method="POST",
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {key}",
                 "X-Hermes-Session-Id": target},
        data=json.dumps({
            "model": "hermes-agent",
            "messages": [{"role": "user",
                          "content": "[The Holographic Eye — memory curation "
                                     "request from Ben's console]\n" + prompt}],
        }).encode(),
    )
    try:
        with urllib.request.urlopen(req, timeout=240) as resp:
            body = json.loads(resp.read())
            used_session = resp.headers.get("X-Hermes-Session-Id", target)
        reply = body["choices"][0]["message"]["content"]
    except Exception as e:
        return {"ok": False, "error": f"agent injection failed: {e}"}
    ev = prov._append("eye", "ask",
                      request={"prompt": prompt, "session_id": used_session,
                               "fact_ids": params.get("fact_ids", [])},
                      response={"reply": reply[:2000],
                                "session_id": used_session})
    if ev is None:
        return {
            "ok": False, "reply": reply, "session_id": used_session,
            "event_id": None, "committed": "unknown", "journaled": False,
            "error": "agent request completed but journal append failed; inspect state before retry",
        }
    return {"ok": True, "reply": reply, "session_id": used_session,
            "event_id": ev["event_id"]}


def _agent_sessions(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    """Live session list from the api_server, so the ask-the-agent modal
    can show exactly where a request will land. Normalized defensively —
    field names vary across api_server versions."""
    import urllib.request
    key = _api_server_key()
    if not key:
        return {"ok": False, "error": "API_SERVER_KEY not configured",
                "eye_attached_session": getattr(prov, "_session_id", "")}
    req = urllib.request.Request(
        "http://127.0.0.1:8642/api/sessions",
        headers={"Authorization": f"Bearer {key}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            body = json.loads(resp.read())
    except Exception as e:
        return {"ok": False, "error": f"session list unavailable: {e}",
                "eye_attached_session": getattr(prov, "_session_id", "")}
    raw = body.get("sessions", body) if isinstance(body, dict) else body
    sessions = []
    for s in (raw if isinstance(raw, list) else []):
        if not isinstance(s, dict):
            continue
        sessions.append({
            "session_id": s.get("session_id") or s.get("id") or "",
            "title": s.get("title") or s.get("name") or "",
            "platform": s.get("platform") or "",
            "updated_at": s.get("updated_at") or s.get("last_active")
                          or s.get("updated") or "",
            "messages": s.get("message_count") or s.get("messages") or None,
        })
    return {"ok": True, "sessions": sessions,
            "default_target": "eye-console",
            "eye_attached_session": getattr(prov, "_session_id", "")}


def _fact_get(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    store = prov.store
    img = images.fact_image(store, int(params["fact_id"]))
    if img is None:
        return {"ok": False, "error": "fact not found"}
    if not params.get("include_vector"):
        img["vector_bytes"] = (
            len(img["hrr_vector_b64"]) * 3 // 4 if img["hrr_vector_b64"] else 0
        )
        img.pop("hrr_vector_b64", None)
    counts = {}
    if prov.journal is not None:
        try:
            counts = prov.journal.retrieval_counts()
        except Exception:
            counts = {}
    img["journal_retrievals"] = counts.get(int(params["fact_id"]), 0)
    return {"ok": True, "fact": img}


def _entities_list(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    store = prov.store
    q = params.get("q", "")
    limit = max(1, min(int(params.get("limit", 100)), 2000))
    offset = max(0, int(params.get("offset", 0)))
    where, args = "", []
    if q:
        where = "WHERE e.name LIKE ? OR e.aliases LIKE ?"
        args = [f"%{q}%", f"%{q}%"]
    rows = store._conn.execute(
        f"""
        SELECT e.entity_id, e.name, e.entity_type, e.aliases, e.created_at,
               COUNT(fe.fact_id) AS fact_count
        FROM entities e
        LEFT JOIN fact_entities fe ON fe.entity_id = e.entity_id
        {where}
        GROUP BY e.entity_id
        ORDER BY fact_count DESC, e.name COLLATE NOCASE
        LIMIT ? OFFSET ?
        """,
        args + [limit, offset],
    ).fetchall()
    total = store._conn.execute("SELECT COUNT(*) FROM entities").fetchone()[0]
    return {"ok": True, "total": total, "entities": [dict(r) for r in rows]}


def _entity_get(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    store = prov.store
    if "entity_id" in params:
        img = images.entity_image(store, int(params["entity_id"]))
    else:
        row = store._conn.execute(
            "SELECT entity_id FROM entities WHERE name = ? COLLATE NOCASE", (params["name"],)
        ).fetchone()
        img = images.entity_image(store, int(row["entity_id"])) if row else None
    if img is None:
        return {"ok": False, "error": "entity not found"}
    facts = []
    for fid in img["fact_ids"]:
        row = store._conn.execute(
            "SELECT fact_id, content, category, trust_score FROM facts WHERE fact_id = ?",
            (fid,),
        ).fetchone()
        if row:
            facts.append(dict(row))
    img["facts"] = facts
    return {"ok": True, "entity": img}
