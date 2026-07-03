"""Before/after images and byte-identical undo (C2/I4 in PLAN.md PART 4).

Capture: full fact rows (hrr_vector as base64), entity links, and any
entities the op created — enough to restore prior state byte-identically.
Restore: raw SQL through the bundled store's own connection + lock (runs
inside the wrapper's Python process, sanctioned by I5), then the bundled
``_rebuild_bank`` regenerates derived bank state.

Copyright (C) 2026 Ben. GPLv3 — see LICENSE.
"""

from __future__ import annotations

import base64
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_FACT_COLS = (
    "fact_id", "content", "category", "tags", "trust_score",
    "retrieval_count", "helpful_count", "created_at", "updated_at",
)


def fact_image(store, fact_id: int) -> Optional[Dict[str, Any]]:
    """Full image of one fact: row (vector as b64) + entity links."""
    row = store._conn.execute(
        "SELECT * FROM facts WHERE fact_id = ?", (fact_id,)
    ).fetchone()
    if row is None:
        return None
    fact = {k: row[k] for k in _FACT_COLS}
    vec = row["hrr_vector"]
    fact["hrr_vector_b64"] = base64.b64encode(vec).decode() if vec is not None else None
    links = store._conn.execute(
        """
        SELECT fe.entity_id, e.name FROM fact_entities fe
        JOIN entities e ON e.entity_id = fe.entity_id
        WHERE fe.fact_id = ?
        """,
        (fact_id,),
    ).fetchall()
    fact["links"] = [{"entity_id": r["entity_id"], "name": r["name"]} for r in links]
    return fact


def fact_image_by_content(store, content: str) -> Optional[Dict[str, Any]]:
    row = store._conn.execute(
        "SELECT fact_id FROM facts WHERE content = ?", (content.strip(),)
    ).fetchone()
    return fact_image(store, int(row["fact_id"])) if row else None


def entity_image(store, entity_id: int) -> Optional[Dict[str, Any]]:
    """Full image of one entity: row + linked fact_ids."""
    row = store._conn.execute(
        "SELECT * FROM entities WHERE entity_id = ?", (entity_id,)
    ).fetchone()
    if row is None:
        return None
    ent = dict(row)
    ent["fact_ids"] = [
        r["fact_id"]
        for r in store._conn.execute(
            "SELECT fact_id FROM fact_entities WHERE entity_id = ?", (entity_id,)
        ).fetchall()
    ]
    return ent


def max_ids(store) -> Dict[str, int]:
    """High-water marks used to detect rows created during a delegated op."""
    f = store._conn.execute("SELECT COALESCE(MAX(fact_id), 0) FROM facts").fetchone()[0]
    e = store._conn.execute("SELECT COALESCE(MAX(entity_id), 0) FROM entities").fetchone()[0]
    return {"fact_id": int(f), "entity_id": int(e)}


def created_since(store, marks: Dict[str, int]) -> Dict[str, Any]:
    """Facts/entities created after the given high-water marks."""
    facts = [
        img for (fid,) in store._conn.execute(
            "SELECT fact_id FROM facts WHERE fact_id > ?", (marks["fact_id"],)
        ).fetchall()
        if (img := fact_image(store, fid)) is not None
    ]
    entities = [
        dict(r) for r in store._conn.execute(
            "SELECT * FROM entities WHERE entity_id > ?", (marks["entity_id"],)
        ).fetchall()
    ]
    return {"facts": facts, "entities_created": entities}


# ---------------------------------------------------------------------------
# Restore (undo)
# ---------------------------------------------------------------------------

def _restore_links(store, fact_id: int, links: List[Dict[str, Any]]) -> None:
    """Re-link a fact to its recorded entities, re-resolving by name when the
    recorded entity_id no longer exists (merged/deleted since)."""
    for link in links or []:
        eid = link.get("entity_id")
        row = store._conn.execute(
            "SELECT entity_id FROM entities WHERE entity_id = ?", (eid,)
        ).fetchone() if eid is not None else None
        if row is None:
            eid = store._resolve_entity(link.get("name", "")) if link.get("name") else None
        if eid is not None:
            store._conn.execute(
                "INSERT OR IGNORE INTO fact_entities (fact_id, entity_id) VALUES (?, ?)",
                (fact_id, eid),
            )


def restore_fact(store, image: Dict[str, Any]) -> None:
    """Write a fact image back byte-identically (row, vector, links)."""
    vec = (
        base64.b64decode(image["hrr_vector_b64"])
        if image.get("hrr_vector_b64") else None
    )
    exists = store._conn.execute(
        "SELECT 1 FROM facts WHERE fact_id = ?", (image["fact_id"],)
    ).fetchone()
    params = [image[c] for c in _FACT_COLS if c != "fact_id"]
    if exists:
        store._conn.execute(
            """
            UPDATE facts SET content=?, category=?, tags=?, trust_score=?,
                   retrieval_count=?, helpful_count=?, created_at=?, updated_at=?,
                   hrr_vector=?
            WHERE fact_id=?
            """,
            params + [vec, image["fact_id"]],
        )
    else:
        store._conn.execute(
            """
            INSERT INTO facts (fact_id, content, category, tags, trust_score,
                   retrieval_count, helpful_count, created_at, updated_at, hrr_vector)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [image["fact_id"]] + params + [vec],
        )
    store._conn.execute("DELETE FROM fact_entities WHERE fact_id = ?", (image["fact_id"],))
    _restore_links(store, image["fact_id"], image.get("links", []))
    store._conn.commit()


def delete_fact_raw(store, fact_id: int) -> None:
    """Remove a fact + links without touching banks (caller rebuilds)."""
    store._conn.execute("DELETE FROM fact_entities WHERE fact_id = ?", (fact_id,))
    store._conn.execute("DELETE FROM facts WHERE fact_id = ?", (fact_id,))
    store._conn.commit()


def delete_orphan_entities(store, entity_rows: List[Dict[str, Any]]) -> List[int]:
    """Delete entities (created by the undone op) that now have no links."""
    removed = []
    for ent in entity_rows or []:
        eid = ent.get("entity_id")
        if eid is None:
            continue
        linked = store._conn.execute(
            "SELECT 1 FROM fact_entities WHERE entity_id = ? LIMIT 1", (eid,)
        ).fetchone()
        if not linked:
            store._conn.execute("DELETE FROM entities WHERE entity_id = ?", (eid,))
            removed.append(int(eid))
    store._conn.commit()
    return removed


def restore_entity(store, image: Dict[str, Any]) -> None:
    """Write an entity image back (row + its side of the links)."""
    exists = store._conn.execute(
        "SELECT 1 FROM entities WHERE entity_id = ?", (image["entity_id"],)
    ).fetchone()
    if exists:
        store._conn.execute(
            "UPDATE entities SET name=?, entity_type=?, aliases=?, created_at=? WHERE entity_id=?",
            (image["name"], image.get("entity_type", "unknown"),
             image.get("aliases", ""), image.get("created_at"), image["entity_id"]),
        )
    else:
        store._conn.execute(
            "INSERT INTO entities (entity_id, name, entity_type, aliases, created_at) VALUES (?, ?, ?, ?, ?)",
            (image["entity_id"], image["name"], image.get("entity_type", "unknown"),
             image.get("aliases", ""), image.get("created_at")),
        )
    for fid in image.get("fact_ids", []):
        if store._conn.execute("SELECT 1 FROM facts WHERE fact_id = ?", (fid,)).fetchone():
            store._conn.execute(
                "INSERT OR IGNORE INTO fact_entities (fact_id, entity_id) VALUES (?, ?)",
                (fid, image["entity_id"]),
            )
    store._conn.commit()
