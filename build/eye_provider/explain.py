"""Explain reads: the provider's algebra with intermediates exposed.

- field.projection — 2D PCA of the stored phase vectors, computed in the
  [cos θ, sin θ] embedding. That embedding is chosen because its inner
  product equals the provider's own similarity measure exactly:
      mean(cos(a-b)) = ([cos a, sin a] · [cos b, sin b]) / dim
  so PCA here is PCA of the retriever's true similarity geometry — the
  Field is the real algebra drawn, not a metaphor (PLAN PART 1).
  The fitted basis is cached so new facts land in a stable projection;
  pass refit=true to refit.

- reason.explain — the exact ``reason`` ranking (same retriever call)
  plus per-entity unbind similarities and the probe-key composition.

- fact.spectrum — FFT magnitudes of fact / entity / bank phase vectors
  (spectrum of e^{iθ}); bind = phase addition, so component structure
  shows as interference peaks. Uses the bundled hrr module throughout.

Copyright (C) 2026 Ben. GPLv3 — see LICENSE.
"""

from __future__ import annotations

import threading
from typing import Any, Dict, List

from plugins.memory.holographic import holographic as hrr

_pca_lock = threading.Lock()
_pca_cache: Dict[str, Dict[str, Any]] = {}


def _np():
    if not hrr._HAS_NUMPY:
        raise RuntimeError("numpy unavailable — the Field requires HRR vectors")
    import numpy as np
    return np


def _embed(np, phases):
    """Phase matrix (N, d) → similarity-preserving embedding (N, 2d)."""
    return np.concatenate([np.cos(phases), np.sin(phases)], axis=1)


def _svd(np, matrix):
    """Run the unchanged SVD with a scoped OpenBLAS thread cap when available."""
    try:
        from threadpoolctl import threadpool_limits
    except ImportError:
        return np.linalg.svd(matrix, full_matrices=False), None
    with threadpool_limits(limits=2, user_api="blas"):
        return np.linalg.svd(matrix, full_matrices=False), 2


# ---------------------------------------------------------------------------
# field.projection
# ---------------------------------------------------------------------------

def field_projection(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    np = _np()
    store = prov.store
    rows = store._conn.execute(
        """
        SELECT fact_id, content, category, tags, trust_score, retrieval_count,
               helpful_count, created_at, updated_at, hrr_vector
        FROM facts ORDER BY fact_id
        """
    ).fetchall()

    with_vec = [r for r in rows if r["hrr_vector"] is not None]
    dim = store.hrr_dim
    try:
        db_key = str(store.db_path.resolve())
    except Exception:
        db_key = str(store.db_path)
    coords: Dict[int, List[float]] = {}
    meta: Dict[str, Any] = {"projector": "pca", "dim": dim,
                            "n_vectors": len(with_vec), "fitted": False}

    if len(with_vec) == 1:
        coords[with_vec[0]["fact_id"]] = [0.0, 0.0]
        meta["explained_variance"] = [0.0, 0.0]
        meta["fitted_n"] = 1
        meta["fitted"] = True
    elif len(with_vec) >= 2:
        phases = np.stack([hrr.bytes_to_phases(r["hrr_vector"]) for r in with_vec])
        X = _embed(np, phases)
        with _pca_lock:
            cache = _pca_cache.get(db_key)
            if (cache is None or params.get("refit")
                    or cache["dim"] != X.shape[1]):
                mean = X.mean(axis=0)
                Xc = X - mean
                (_, s, vt), svd_threads = _svd(np, Xc)
                meta["svd_threads"] = svd_threads
                comp = vt[:2].copy()
                for i in range(2):  # deterministic sign convention
                    j = int(np.argmax(np.abs(comp[i])))
                    if comp[i][j] < 0:
                        comp[i] = -comp[i]
                total = float((s ** 2).sum()) or 1.0
                cache = {
                    "mean": mean, "comp": comp, "dim": X.shape[1],
                    "db_key": db_key,
                    "svd_threads": svd_threads,
                    "explained": [float(s[0] ** 2 / total),
                                  float(s[1] ** 2 / total)],
                    "fitted_n": len(with_vec),
                }
                _pca_cache[db_key] = cache
                meta["fitted"] = True
            xy = (X - cache["mean"]) @ cache["comp"].T
            meta["explained_variance"] = cache["explained"]
            meta["fitted_n"] = cache["fitted_n"]
            meta["svd_threads"] = cache.get("svd_threads")
        for r, (x, y) in zip(with_vec, xy):
            coords[r["fact_id"]] = [round(float(x), 5), round(float(y), 5)]

    # entity names per fact, one pass
    ent_map: Dict[int, List[str]] = {}
    for fid, name in store._conn.execute(
        """
        SELECT fe.fact_id, e.name FROM fact_entities fe
        JOIN entities e ON e.entity_id = fe.entity_id
        """
    ).fetchall():
        ent_map.setdefault(fid, []).append(name)

    jr: Dict[int, int] = {}
    if prov.journal is not None:
        try:
            jr = prov.journal.retrieval_counts()
        except Exception:
            jr = {}

    facts = []
    for r in rows:
        fid = r["fact_id"]
        xy = coords.get(fid)
        facts.append({
            "fact_id": fid,
            "x": xy[0] if xy else None,
            "y": xy[1] if xy else None,
            "has_vector": r["hrr_vector"] is not None,
            "content": r["content"],
            "category": r["category"],
            "tags": r["tags"],
            "trust_score": r["trust_score"],
            "retrieval_count": max(r["retrieval_count"], jr.get(fid, 0)),
            "helpful_count": r["helpful_count"],
            "created_at": r["created_at"],
            "updated_at": r["updated_at"],
            "entities": ent_map.get(fid, []),
        })
    return {"ok": True, "meta": meta, "facts": facts}


# ---------------------------------------------------------------------------
# reason.explain
# ---------------------------------------------------------------------------

def reason_explain(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    np = _np()
    entities = [e for e in (params.get("entities") or []) if e]
    if not entities:
        return {"ok": False, "error": "entities required"}
    category = params.get("category")
    limit = int(params.get("limit", 12))
    retriever = prov.retriever
    store = prov.store

    # the ranking IS the provider's ranking — same call the agent's tool makes
    ranked = retriever.reason(entities, category=category, limit=limit)

    dim = retriever.hrr_dim
    role_entity = hrr.encode_atom("__hrr_role_entity__", dim)
    role_content = hrr.encode_atom("__hrr_role_content__", dim)
    probe_keys = {
        e: hrr.bind(hrr.encode_atom(e.lower(), dim), role_entity) for e in entities
    }

    results = []
    for fact in ranked:
        row = store._conn.execute(
            "SELECT hrr_vector FROM facts WHERE fact_id = ?", (fact["fact_id"],)
        ).fetchone()
        breakdown = {}
        if row and row["hrr_vector"] is not None:
            fact_vec = hrr.bytes_to_phases(row["hrr_vector"])
            for e, key in probe_keys.items():
                residual = hrr.unbind(fact_vec, key)
                breakdown[e] = round(float(hrr.similarity(residual, role_content)), 4)
        results.append({**{k: v for k, v in fact.items()},
                        "entity_sims": breakdown,
                        "min_sim": min(breakdown.values()) if breakdown else None})

    math_trace = [
        f'probe_key[{e}] = bind(encode_atom("{e.lower()}"), ROLE_ENTITY)'
        for e in entities
    ] + [
        "per fact: residual[e] = unbind(fact_vec, probe_key[e])",
        "          sim[e]      = similarity(residual[e], ROLE_CONTENT)",
        "score = (min(sim) + 1)/2 × trust_score   (AND semantics via min)",
    ]
    return {"ok": True, "entities": entities, "results": results,
            "math": math_trace, "dim": dim}


# ---------------------------------------------------------------------------
# fact.spectrum
# ---------------------------------------------------------------------------

def _spectrum(np, phases) -> List[float]:
    mags = np.abs(np.fft.fft(np.exp(1j * phases)))
    peak = float(mags.max()) or 1.0
    return [round(float(m / peak), 4) for m in mags]


def fact_spectrum(prov, params: Dict[str, Any]) -> Dict[str, Any]:
    np = _np()
    store = prov.store
    dim = store.hrr_dim
    traces: List[Dict[str, Any]] = []
    composition: List[Dict[str, Any]] = []

    if "fact_id" in params:
        fid = int(params["fact_id"])
        row = store._conn.execute(
            "SELECT content, category, hrr_vector FROM facts WHERE fact_id = ?", (fid,)
        ).fetchone()
        if row is None or row["hrr_vector"] is None:
            return {"ok": False, "error": "fact not found or no vector"}
        vec = hrr.bytes_to_phases(row["hrr_vector"])
        traces.append({"label": f"f#{fid:04d}", "kind": "fact",
                       "category": row["category"], "bins": _spectrum(np, vec)})
        # composition: each bound component's own spectral peak
        role_content = hrr.encode_atom("__hrr_role_content__", dim)
        role_entity = hrr.encode_atom("__hrr_role_entity__", dim)
        comp_vecs = [("content × ROLE_CONTENT",
                      hrr.bind(hrr.encode_text(row["content"], dim), role_content))]
        for name in [r[0] for r in store._conn.execute(
            """SELECT e.name FROM entities e JOIN fact_entities fe
               ON fe.entity_id = e.entity_id WHERE fe.fact_id = ?""", (fid,))]:
            comp_vecs.append((f"{name.lower()} × ROLE_ENTITY",
                              hrr.bind(hrr.encode_atom(name.lower(), dim), role_entity)))
        for label, v in comp_vecs:
            mags = np.abs(np.fft.fft(np.exp(1j * v)))
            composition.append({"component": label,
                                "peak_bin": int(np.argmax(mags)),
                                "peak_mag": round(float(mags.max()), 2)})

    for name in params.get("entities") or []:
        v = hrr.bind(hrr.encode_atom(name.lower(), dim),
                     hrr.encode_atom("__hrr_role_entity__", dim))
        traces.append({"label": name, "kind": "entity", "bins": _spectrum(np, v)})

    for cat in params.get("banks") or []:
        row = store._conn.execute(
            "SELECT vector FROM memory_banks WHERE bank_name = ?", (f"cat:{cat}",)
        ).fetchone()
        if row:
            v = hrr.bytes_to_phases(row["vector"])
            traces.append({"label": f"cat:{cat}", "kind": "bank",
                           "bins": _spectrum(np, v)})

    if not traces:
        return {"ok": False, "error": "nothing to plot"}
    return {"ok": True, "dim": dim, "traces": traces, "composition": composition}
