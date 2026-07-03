"""P1 acceptance harness — The Holographic Eye.

Runs OFFLINE against two sqlite-backup copies of the live memory DB
(never the live file):

  Q2  HRR determinism: same content+entities → byte-identical vectors
      across two subprocess invocations.
  I2  byte-equivalence: a scripted fact_store/fact_feedback/prefetch
      session against STOCK holographic vs the WRAPPED provider —
      every returned string must match byte-for-byte, and the final DB
      states must be identical.
  I3  the wrapped run journals exactly one event per op, with complete
      before/after images on every mutation.

Usage: HERMES_REPO=~/.hermes/hermes-agent venv-python p1_equivalence.py
"""

from __future__ import annotations

import base64
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

HERMES_REPO = Path(os.environ.get("HERMES_REPO", "~/.hermes/hermes-agent")).expanduser()
LIVE_DB = Path("~/.hermes/memory_store.db").expanduser()
EYE_DIR = Path(__file__).resolve().parent.parent / "eye_provider"

sys.path.insert(0, str(HERMES_REPO))

FAIL = 0


def check(label: str, ok: bool, detail: str = "") -> None:
    global FAIL
    mark = "PASS" if ok else "FAIL"
    if not ok:
        FAIL += 1
    print(f"[{mark}] {label}" + (f" — {detail}" if detail else ""))


# ---------------------------------------------------------------------------
# Q2 — HRR determinism across processes
# ---------------------------------------------------------------------------

def verify_q2() -> None:
    snippet = (
        "import sys, hashlib; sys.path.insert(0, %r); "
        "from plugins.memory.holographic import holographic as hrr; "
        "v = hrr.encode_fact('The Eye verifies HRR determinism', "
        "['pycharm verification', 'pytest'], 1024); "
        "print(hashlib.sha256(hrr.phases_to_bytes(v)).hexdigest())"
    ) % str(HERMES_REPO)
    digests = set()
    for _ in range(2):
        out = subprocess.run(
            [sys.executable, "-c", snippet], capture_output=True, text=True, check=True
        )
        digests.add(out.stdout.strip())
    check("Q2 HRR determinism (2 processes, same digest)", len(digests) == 1,
          next(iter(digests))[:16])


# ---------------------------------------------------------------------------
# I2 / I3 — stock-vs-wrapped scripted session
# ---------------------------------------------------------------------------

SCRIPT = [
    ("fact_store", {"action": "add", "content":
        "Eye verification fact Alpha: Ben tests PyCharm Verification with 'pytest'.",
        "category": "user_pref", "tags": "verify,alpha"}),
    ("fact_store", {"action": "add", "content":
        "Eye verification fact Beta: the Verification Project uses SQLite WAL.",
        "category": "project", "tags": "verify,beta"}),
    # dedupe path — same content as Alpha
    ("fact_store", {"action": "add", "content":
        "Eye verification fact Alpha: Ben tests PyCharm Verification with 'pytest'.",
        "category": "user_pref"}),
    ("fact_store", {"action": "search", "query": "verification pytest sqlite"}),
    ("fact_store", {"action": "probe", "entity": "PyCharm Verification", "limit": 5}),
    ("fact_store", {"action": "related", "entity": "pytest", "limit": 5}),
    ("fact_store", {"action": "reason",
                    "entities": ["PyCharm Verification", "Verification Project"],
                    "limit": 5}),
    ("fact_store", {"action": "list", "limit": 5}),
    ("fact_store", {"action": "contradict", "limit": 3}),
    ("__UPDATE_BETA__", {"action": "update", "trust_delta": 0.2,
                         "content": "Eye verification fact Beta: the Verification "
                                    "Project uses SQLite WAL and FTS5.",
                         "tags": "verify,beta,edited"}),
    ("__FEEDBACK_ALPHA__", {"action": "helpful"}),
    ("__FEEDBACK_BETA__", {"action": "unhelpful"}),
    ("__REMOVE_BETA__", {"action": "remove"}),
    ("fact_store", {"action": "search", "query": "verification"}),
    ("fact_store", {"action": "list", "limit": 5, "category": "user_pref"}),
]


def snapshot_db(db_path: Path) -> dict:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    out = {}
    for table, order in (("facts", "fact_id"), ("entities", "entity_id"),
                         ("fact_entities", "fact_id, entity_id"),
                         ("memory_banks", "bank_name")):
        rows = []
        for r in conn.execute(f"SELECT * FROM {table} ORDER BY {order}"):
            d = dict(r)
            for k, v in d.items():
                if isinstance(v, bytes):
                    d[k] = base64.b64encode(v).decode()
            rows.append(d)
        out[table] = rows
    conn.close()
    return out


def copy_live_db(dest: Path) -> None:
    src = sqlite3.connect(f"file:{LIVE_DB}?mode=ro", uri=True)
    dst = sqlite3.connect(str(dest))
    src.backup(dst)
    src.close()
    dst.close()


def load_eye_module():
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "holographic_eye_verify", str(EYE_DIR / "__init__.py"),
        submodule_search_locations=[str(EYE_DIR)],
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["holographic_eye_verify"] = mod
    spec.loader.exec_module(mod)
    return mod


def verify_i2_i3(tmp: Path) -> None:
    from plugins.memory.holographic import HolographicMemoryProvider

    db_a, db_b = tmp / "stock.db", tmp / "wrapped.db"
    copy_live_db(db_a)
    copy_live_db(db_b)
    journal_path = tmp / "eye_journal.db"

    stock = HolographicMemoryProvider(config={"db_path": str(db_a)})
    stock.initialize("verify-session")

    eye_mod = load_eye_module()
    inner = HolographicMemoryProvider(config={"db_path": str(db_b)})
    wrapped = eye_mod.EyeMemoryProvider(
        config={"journal_path": str(journal_path), "mode": "journal"}, inner=inner
    )
    wrapped.initialize("verify-session")

    check("wrapped provider name", wrapped.name == "holographic-eye", wrapped.name)
    check("tool schemas identical",
          json.dumps(stock.get_tool_schemas()) == json.dumps(wrapped.get_tool_schemas()))
    check("system_prompt_block identical",
          stock.system_prompt_block() == wrapped.system_prompt_block())

    # run the script, interleaved per-op, resolving dynamic fact ids per side
    ids = {"stock": {}, "wrapped": {}}
    mismatches = 0
    for i, (tool, args) in enumerate(SCRIPT):
        results = {}
        for side, prov in (("stock", stock), ("wrapped", wrapped)):
            t, a = tool, dict(args)
            if tool == "__UPDATE_BETA__":
                t, a["fact_id"] = "fact_store", ids[side]["beta"]
            elif tool == "__FEEDBACK_ALPHA__":
                t, a["fact_id"] = "fact_feedback", ids[side]["alpha"]
            elif tool == "__FEEDBACK_BETA__":
                t, a["fact_id"] = "fact_feedback", ids[side]["beta"]
            elif tool == "__REMOVE_BETA__":
                t, a["fact_id"] = "fact_store", ids[side]["beta"]
            results[side] = prov.handle_tool_call(t, a)
            if tool == "fact_store" and args.get("action") == "add":
                fid = json.loads(results[side]).get("fact_id")
                key = "alpha" if "Alpha" in args["content"] else "beta"
                ids[side].setdefault(key, fid)
        if results["stock"] != results["wrapped"]:
            mismatches += 1
            print(f"    op {i} ({tool}/{args.get('action')}):")
            print(f"      stock:   {results['stock'][:220]}")
            print(f"      wrapped: {results['wrapped'][:220]}")
    check("I2 tool results byte-identical", mismatches == 0,
          f"{len(SCRIPT)} ops, {mismatches} mismatches")

    pf_s = stock.prefetch("verification pytest", session_id="verify-session")
    pf_w = wrapped.prefetch("verification pytest", session_id="verify-session")
    check("I2 prefetch block identical", pf_s == pf_w, f"{len(pf_w)} chars")

    # mirror + auto-extract paths fire identically
    stock.on_memory_write("add", "user", "Eye mirror check: Ben prefers 'Blossom' pink.")
    wrapped.on_memory_write("add", "user", "Eye mirror check: Ben prefers 'Blossom' pink.")
    msgs = [{"role": "user", "content": "I always keep the Eye verification tidy"}]
    stock._config["auto_extract"] = True
    inner._config["auto_extract"] = True
    stock.on_session_end(msgs)
    wrapped.on_session_end(msgs)

    # final DB state comparison
    snap_a, snap_b = snapshot_db(db_a), snapshot_db(db_b)
    if snap_a == snap_b:
        check("I2 final DB state identical", True)
    else:
        diffs = []
        for table in snap_a:
            if snap_a[table] != snap_b[table]:
                diffs.append(table)
        check("I2 final DB state identical", False, f"diff in: {diffs}")

    # I3 — journal completeness
    j = sqlite3.connect(str(journal_path))
    j.row_factory = sqlite3.Row
    events = [dict(r) for r in j.execute("SELECT * FROM events ORDER BY event_id")]
    tool_events = [e for e in events if e["source"] == "tool"]
    check("I3 one journal event per tool op",
          len(tool_events) == len(SCRIPT), f"{len(tool_events)}/{len(SCRIPT)}")
    mut = [e for e in tool_events
           if e["kind"] in ("add", "update", "remove", "helpful", "unhelpful")]
    missing = [e["event_id"] for e in mut
               if not e["after"] and e["kind"] != "remove"]
    missing += [e["event_id"] for e in mut
                if e["kind"] in ("update", "remove", "helpful", "unhelpful")
                and not e["before"]]
    check("I3 mutations carry before/after images", not missing,
          f"{len(mut)} mutations" + (f", missing: {missing}" if missing else ""))
    has_vec = 0
    for e in mut:
        img = json.loads(e["before"] or e["after"] or "{}")
        facts = img.get("facts") or []
        if facts and facts[0] and facts[0].get("hrr_vector_b64"):
            has_vec += 1
    check("I3 images include hrr_vector b64", has_vec > 0, f"{has_vec} events")
    for src in ("prefetch", "mirror", "auto_extract", "session"):
        n = sum(1 for e in events if e["source"] == src)
        check(f"I3 source={src} journaled", n > 0, f"{n} events")

    prefetch_ev = next(e for e in events if e["source"] == "prefetch")
    resp = json.loads(prefetch_ev["response"])
    check("prefetch event carries exact block + fact_ids",
          resp.get("block") == pf_w and isinstance(resp.get("fact_ids"), list),
          f"{len(resp.get('fact_ids', []))} ids")

    wrapped.shutdown()
    stock.shutdown()


if __name__ == "__main__":
    os.environ.setdefault("HERMES_HOME", tempfile.mkdtemp(prefix="eye-verify-home-"))
    verify_q2()
    with tempfile.TemporaryDirectory(prefix="eye-p1-") as tmp:
        verify_i2_i3(Path(tmp))
    print("\n" + ("ALL CHECKS PASSED" if FAIL == 0 else f"{FAIL} CHECK(S) FAILED"))
    sys.exit(1 if FAIL else 0)
