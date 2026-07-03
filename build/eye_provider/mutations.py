"""Eye-side mutations: journaled, undoable, provider-invariant-preserving.

Every mutation here (source=eye) goes through the bundled store's own
Python API where one exists (I5); the few raw-SQL paths (byte-identical
undo restores, entity merge relinking) run inside the wrapper's process
under the store's lock, then hand derived state back to the bundled
machinery (``_compute_hrr_vector``, ``_rebuild_bank``).

undo(event_id) restores the prior state byte-identically from the
journal's before-image (invariant I4) and is itself journaled.

Copyright (C) 2026 Ben. GPLv3 — see LICENSE.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Optional

from . import images

logger = logging.getLogger(__name__)


def dispatch(prov, method: str, params: Dict[str, Any]) -> Dict[str, Any]:
    fn = {
        "fact.preview_update": preview_update,
        "fact.add": fact_add,
        "fact.update": fact_update,
        "fact.remove": fact_remove,
        "fact.trust_set": fact_trust_set,
        "fact.feedback": fact_feedback,
        "entity.merge": entity_merge,
        "entity.alias": entity_alias,
        "entity.remove": entity_remove,
        "undo": undo,
        "backfill_vectors": backfill_vectors,
    }.get(method)
    if fn is None:
        return {"error": f"unknown method: {method}"}
    return fn(prov, params)


def _append(prov, kind: str, **kw) -> Optional[Dict[str, Any]]:
    ev = prov._append("eye", kind, **kw)
    return ev


def _rebuild_banks(store, categories) -> None:
    for cat in {c for c in categories if c}:
        store._rebuild_bank(cat)


# ---------------------------------------------------------------------------
# Previews (server-computed by the real provider code — never client-side)
# ---------------------------------------------------------------------------

def preview_update(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    store = prov.store
    fact_id = int(params["fact_id"])
    current = images.fact_image(store, fact_id)
    if current is None:
        return {"ok": False, "error": "fact not found"}
    new_content = params.get("content", current["content"])
    new_category = params.get("category", current["category"])

    predicted = []
    if "content" in params:
        for name in store._extract_entities(new_content):
            row = store._conn.execute(
                "SELECT entity_id FROM entities WHERE name LIKE ?", (name,)
            ).fetchone()
            if row is None:
                row = store._conn.execute(
                    "SELECT entity_id FROM entities "
                    "WHERE ',' || aliases || ',' LIKE '%,' || ? || ',%'",
                    (name,),
                ).fetchone()
            predicted.append({"name": name, "exists": row is not None})
    else:
        predicted = [
            {"name": l["name"], "exists": True} for l in current.get("links", [])
        ]

    removed = [
        l["name"] for l in current.get("links", [])
        if l["name"].lower() not in {p["name"].lower() for p in predicted}
    ] if "content" in params else []

    counts = {
        r[0]: r[1] for r in store._conn.execute(
            "SELECT category, COUNT(*) FROM facts GROUP BY category"
        )
    }
    banks = [{"bank": f"cat:{new_category}",
              "fact_count": counts.get(new_category, 0) + (0 if new_category == current["category"] else 1),
              "action": "rebuild"}]
    if new_category != current["category"]:
        banks.append({"bank": f"cat:{current['category']}",
                      "fact_count": max(0, counts.get(current["category"], 1) - 1),
                      "action": "rebuild"})
    return {
        "ok": True,
        "before": {"content": current["content"], "category": current["category"],
                   "tags": current["tags"]},
        "after": {"content": new_content, "category": new_category,
                  "tags": params.get("tags", current["tags"])},
        "predicted_entities": predicted,
        "entities_removed": removed,
        "bank_impact": banks,
    }


# ---------------------------------------------------------------------------
# Fact mutations (via the bundled store API)
# ---------------------------------------------------------------------------

def fact_add(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    store = prov.store
    marks = images.max_ids(store)
    before = images.fact_image_by_content(store, params["content"])
    fact_id = store.add_fact(
        params["content"],
        category=params.get("category", "general"),
        tags=params.get("tags", ""),
    )
    after = {"facts": [images.fact_image(store, fact_id)]}
    created = images.created_since(store, marks)
    if created["entities_created"]:
        after["entities_created"] = created["entities_created"]
    ev = _append(prov, "fact.add", request=params,
                 response={"fact_id": fact_id,
                           "deduped": before is not None},
                 before={"facts": [before] if before else []}, after=after)
    return {"ok": True, "fact_id": fact_id, "deduped": before is not None,
            "event_id": ev["event_id"] if ev else None}


def fact_update(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    store = prov.store
    fact_id = int(params["fact_id"])
    before = images.fact_image(store, fact_id)
    if before is None:
        return {"ok": False, "error": "fact not found"}
    marks = images.max_ids(store)
    updated = store.update_fact(
        fact_id,
        content=params.get("content"),
        trust_delta=float(params["trust_delta"]) if "trust_delta" in params else None,
        tags=params.get("tags"),
        category=params.get("category"),
    )
    after_img = images.fact_image(store, fact_id)
    after: Dict[str, Any] = {"facts": [after_img]}
    created = images.created_since(store, marks)
    if created["entities_created"]:
        after["entities_created"] = created["entities_created"]
    if params.get("category") and params["category"] != before["category"]:
        _rebuild_banks(store, [before["category"]])
    ev = _append(prov, "fact.update", request=params, response={"updated": updated},
                 before={"facts": [before]}, after=after)
    return {"ok": updated, "fact": after_img,
            "event_id": ev["event_id"] if ev else None}


def fact_remove(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    store = prov.store
    fact_id = int(params["fact_id"])
    before = images.fact_image(store, fact_id)
    if before is None:
        return {"ok": False, "error": "fact not found"}
    removed = store.remove_fact(fact_id)
    ev = _append(prov, "fact.remove", request=params, response={"removed": removed},
                 before={"facts": [before]}, after={"facts": []})
    return {"ok": removed, "event_id": ev["event_id"] if ev else None}


def fact_trust_set(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    """Absolute trust set, applied as a delta through the store API."""
    store = prov.store
    fact_id = int(params["fact_id"])
    target = max(0.0, min(1.0, float(params["trust"])))
    before = images.fact_image(store, fact_id)
    if before is None:
        return {"ok": False, "error": "fact not found"}
    store.update_fact(fact_id, trust_delta=target - float(before["trust_score"]))
    after = images.fact_image(store, fact_id)
    ev = _append(prov, "fact.trust_set", request=params,
                 response={"old_trust": before["trust_score"],
                           "new_trust": after["trust_score"]},
                 before={"facts": [before]}, after={"facts": [after]})
    return {"ok": True, "fact": after, "event_id": ev["event_id"] if ev else None}


def fact_feedback(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    store = prov.store
    fact_id = int(params["fact_id"])
    helpful = bool(params.get("helpful", params.get("action") == "helpful"))
    before = images.fact_image(store, fact_id)
    if before is None:
        return {"ok": False, "error": "fact not found"}
    result = store.record_feedback(fact_id, helpful=helpful)
    after = images.fact_image(store, fact_id)
    ev = _append(prov, "helpful" if helpful else "unhelpful",
                 request=params, response=result,
                 before={"facts": [before]}, after={"facts": [after]})
    return {"ok": True, "result": result, "fact": after,
            "event_id": ev["event_id"] if ev else None}


# ---------------------------------------------------------------------------
# Entity desk
# ---------------------------------------------------------------------------

def _reencode_facts(store, fact_ids: List[int]) -> List[str]:
    """Recompute HRR vectors for facts whose entity links changed; returns
    the affected categories (for bank rebuilds)."""
    cats = []
    for fid in fact_ids:
        row = store._conn.execute(
            "SELECT content, category FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        if row:
            store._compute_hrr_vector(fid, row["content"])
            cats.append(row["category"])
    return cats


def entity_merge(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    """Merge src entity into dst: relink facts, absorb name+aliases,
    delete src, re-encode affected fact vectors, rebuild banks."""
    store = prov.store
    src_id, dst_id = int(params["src_id"]), int(params["dst_id"])
    if src_id == dst_id:
        return {"ok": False, "error": "src and dst are the same entity"}
    src = images.entity_image(store, src_id)
    dst = images.entity_image(store, dst_id)
    if src is None or dst is None:
        return {"ok": False, "error": "entity not found"}

    with store._lock:
        for fid in src["fact_ids"]:
            store._conn.execute(
                "INSERT OR IGNORE INTO fact_entities (fact_id, entity_id) VALUES (?, ?)",
                (fid, dst_id),
            )
        store._conn.execute("DELETE FROM fact_entities WHERE entity_id = ?", (src_id,))
        aliases = [a.strip() for a in (dst.get("aliases") or "").split(",") if a.strip()]
        for candidate in [src["name"]] + [
            a.strip() for a in (src.get("aliases") or "").split(",") if a.strip()
        ]:
            if candidate.lower() != dst["name"].lower() and candidate.lower() not in {
                a.lower() for a in aliases
            }:
                aliases.append(candidate)
        store._conn.execute(
            "UPDATE entities SET aliases = ? WHERE entity_id = ?",
            (",".join(aliases), dst_id),
        )
        store._conn.execute("DELETE FROM entities WHERE entity_id = ?", (src_id,))
        store._conn.commit()
        affected = sorted(set(src["fact_ids"]) | set(dst["fact_ids"]))
        cats = _reencode_facts(store, affected)
        _rebuild_banks(store, cats)

    after = {"entities": [images.entity_image(store, dst_id)]}
    ev = _append(prov, "entity.merge", request=params,
                 response={"merged": src["name"], "into": dst["name"],
                           "facts_relinked": len(src["fact_ids"])},
                 before={"entities": [src, dst]}, after=after)
    return {"ok": True, "merged": src["name"], "into": dst["name"],
            "facts_relinked": len(src["fact_ids"]),
            "event_id": ev["event_id"] if ev else None}


def entity_alias(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    store = prov.store
    entity_id = int(params["entity_id"])
    before = images.entity_image(store, entity_id)
    if before is None:
        return {"ok": False, "error": "entity not found"}
    with store._lock:
        updates, args = [], []
        if "name" in params:
            updates.append("name = ?")
            args.append(params["name"])
        if "aliases" in params:
            updates.append("aliases = ?")
            args.append(params["aliases"])
        if "entity_type" in params:
            updates.append("entity_type = ?")
            args.append(params["entity_type"])
        if not updates:
            return {"ok": False, "error": "nothing to change"}
        store._conn.execute(
            f"UPDATE entities SET {', '.join(updates)} WHERE entity_id = ?",
            args + [entity_id],
        )
        store._conn.commit()
        cats = []
        if "name" in params:  # entity name participates in fact encoding
            cats = _reencode_facts(store, before["fact_ids"])
            _rebuild_banks(store, cats)
    after = images.entity_image(store, entity_id)
    ev = _append(prov, "entity.alias", request=params,
                 response={"updated": True},
                 before={"entities": [before]}, after={"entities": [after]})
    return {"ok": True, "entity": after, "event_id": ev["event_id"] if ev else None}


def entity_remove(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    store = prov.store
    entity_id = int(params["entity_id"])
    before = images.entity_image(store, entity_id)
    if before is None:
        return {"ok": False, "error": "entity not found"}
    with store._lock:
        store._conn.execute("DELETE FROM fact_entities WHERE entity_id = ?", (entity_id,))
        store._conn.execute("DELETE FROM entities WHERE entity_id = ?", (entity_id,))
        store._conn.commit()
        cats = _reencode_facts(store, before["fact_ids"])
        _rebuild_banks(store, cats)
    ev = _append(prov, "entity.remove", request=params,
                 response={"removed": before["name"],
                           "facts_unlinked": len(before["fact_ids"])},
                 before={"entities": [before]}, after={"entities": []})
    return {"ok": True, "removed": before["name"],
            "event_id": ev["event_id"] if ev else None}


# ---------------------------------------------------------------------------
# Backfill (Risk 3: NULL hrr_vector rows)
# ---------------------------------------------------------------------------

def backfill_vectors(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    store = prov.store
    rows = store._conn.execute(
        "SELECT fact_id, content, category FROM facts WHERE hrr_vector IS NULL"
    ).fetchall()
    before = {"facts": [images.fact_image(store, r["fact_id"]) for r in rows]}
    with store._lock:
        cats = set()
        for r in rows:
            store._compute_hrr_vector(r["fact_id"], r["content"])
            cats.add(r["category"])
        _rebuild_banks(store, cats)
    after = {"facts": [images.fact_image(store, r["fact_id"]) for r in rows]}
    ev = _append(prov, "backfill_vectors", request=params,
                 response={"backfilled": len(rows)}, before=before, after=after)
    return {"ok": True, "backfilled": len(rows),
            "fact_ids": [r["fact_id"] for r in rows],
            "event_id": ev["event_id"] if ev else None}


# ---------------------------------------------------------------------------
# Undo (I4 — byte-identical restore from the journal's before-image)
# ---------------------------------------------------------------------------

_UNDOABLE_FACT_KINDS = {
    "add", "update", "remove", "helpful", "unhelpful",
    "fact.add", "fact.update", "fact.remove", "fact.trust_set",
}


def undo(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    journal = prov.journal
    store = prov.store
    if journal is None:
        return {"ok": False, "error": "journal unavailable"}
    event_id = int(params["event_id"])
    ev = journal.get_event(event_id)
    if ev is None:
        return {"ok": False, "error": f"event {event_id} not found"}
    if ev["undone_by"]:
        return {"ok": False, "error": f"already undone by event {ev['undone_by']}"}
    if ev["source"] == "undo":
        return {"ok": False, "error": "cannot undo an undo (v1)"}

    before = json.loads(ev["before"]) if ev["before"] else {}
    after = json.loads(ev["after"]) if ev["after"] else {}
    kind, source = ev["kind"], ev["source"]
    cats: set = set()
    current: Dict[str, Any] = {}

    # Creation events (agent add, eye add, mirror, auto-extract) revert by
    # deleting what they created. An add that deduped onto an existing fact
    # created nothing — refuse instead of "restoring" an identical image.
    is_creation = source in ("mirror", "auto_extract") or kind in ("add", "fact.add")
    had_prior = bool(before.get("facts") and before["facts"][0:1] and before["facts"][0])

    with store._lock:
        if is_creation:
            if had_prior:
                return {"ok": False,
                        "error": "nothing to undo — this add deduped onto an "
                                 "existing fact and changed nothing"}
            created = [f for f in (after.get("facts") or []) if f]
            if not created:
                return {"ok": False, "error": "nothing to undo (empty op)"}
            current = {"facts": [images.fact_image(store, f["fact_id"])
                                 for f in created]}
            for f in created:
                if images.fact_image(store, f["fact_id"]) is not None:
                    cats.add(f["category"])
                    images.delete_fact_raw(store, f["fact_id"])
            images.delete_orphan_entities(store, after.get("entities_created") or [])
        elif kind in _UNDOABLE_FACT_KINDS:
            facts_before = [f for f in (before.get("facts") or []) if f]
            if not facts_before:
                return {"ok": False, "error": "no before-image to restore"}
            current = {"facts": [images.fact_image(store, f["fact_id"])
                                 for f in facts_before]}
            for f in facts_before:
                now = images.fact_image(store, f["fact_id"])
                if now:
                    cats.add(now["category"])
                images.restore_fact(store, f)
                cats.add(f["category"])
            images.delete_orphan_entities(store, after.get("entities_created") or [])
        elif kind == "entity.merge":
            src, dst = before["entities"][0], before["entities"][1]
            current = {"entities": [images.entity_image(store, dst["entity_id"])]}
            extra = set(src["fact_ids"]) - set(dst["fact_ids"])
            for fid in extra:
                store._conn.execute(
                    "DELETE FROM fact_entities WHERE fact_id = ? AND entity_id = ?",
                    (fid, dst["entity_id"]),
                )
            images.restore_entity(store, src)
            images.restore_entity(store, dst)
            store._conn.commit()
            cats.update(_reencode_facts(
                store, sorted(set(src["fact_ids"]) | set(dst["fact_ids"]))
            ))
        elif kind in ("entity.alias", "entity.remove"):
            ent = before["entities"][0]
            live = images.entity_image(store, ent["entity_id"])
            current = {"entities": [live] if live else []}
            images.restore_entity(store, ent)
            cats.update(_reencode_facts(store, ent["fact_ids"]))
        elif kind == "backfill_vectors":
            for f in before.get("facts") or []:
                images.restore_fact(store, f)
                cats.add(f["category"])
        else:
            return {"ok": False, "error": f"kind '{kind}' is not undoable"}
        _rebuild_banks(store, cats)

    undo_ev = prov._append(
        "undo", "undo",
        request={"event_id": event_id, "undone_kind": kind, "undone_source": source},
        response={"restored": True},
        before=current, after=before or after,
    )
    if undo_ev:
        journal.mark_undone(event_id, undo_ev["event_id"])
    return {"ok": True, "undone_event": event_id,
            "event_id": undo_ev["event_id"] if undo_ev else None}
