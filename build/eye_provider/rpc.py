"""RPC dispatch for the Eye control plane (C4 method surface, PLAN PART 4).

Read passthroughs call the *inner* provider's own handle_tool_call and
return its byte-exact string (invariant I6); GUI reads are not journaled
(I3 covers mutations). Mutations live in mutations.py (journaled,
source=eye, undoable); explain/projection reads live in explain.py.

Copyright (C) 2026 Ben. GPLv3 — see LICENSE.
"""

from __future__ import annotations

import json
from typing import Any, Dict

from . import images

_PASSTHROUGH_ACTIONS = {"search", "probe", "related", "reason", "contradict", "list"}


def dispatch(plane, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
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
        return _agent_ask(prov, params)
    if method == "agent.sessions":
        return _agent_sessions(prov, params)

    # -- backup memory (D-0007) -----------------------------------------------------
    if method == "backup.create":
        from . import backup
        return backup.backup_create(prov, params)
    if method == "backup.list":
        from . import backup
        return backup.backup_list(prov, params)

    # -- previews + mutations (journaled, source=eye) ------------------------------
    if method == "fact.preview_update" or method.startswith(
        ("fact.", "entity.", "undo", "backfill")
    ):
        from . import mutations
        return mutations.dispatch(prov, method, params)

    return {"error": f"unknown method: {method}"}


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
    return {"ok": True, "reply": reply, "session_id": used_session,
            "event_id": ev["event_id"] if ev else None}


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
            "SELECT entity_id FROM entities WHERE name LIKE ?", (params["name"],)
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
