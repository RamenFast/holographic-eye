"""P2 acceptance harness — control plane (+ early P4/P5 spot checks).

Offline: wrapped provider on a temp copy of the live DB, control plane on
a test port.

  I6  RPC read passthrough is byte-equivalent to the agent's tool calls
  I7  WS client death never affects the provider; events land < 250ms
  I8  loopback bind + 401 on bad token
  I4  fact.add/update/remove/trust_set/feedback → undo restores the DB
      byte-identically (full-table SQL diff)
  Q6  projection sanity: entity-sharing fact pairs sit closer in the
      Field than random pairs
  P5  reason.explain ranking == retriever.reason; spectrum well-formed
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import sqlite3
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERMES_REPO = Path(os.environ.get("HERMES_REPO", "~/.hermes/hermes-agent")).expanduser()
LIVE_DB = Path("~/.hermes/memory_store.db").expanduser()
EYE_DIR = Path(__file__).resolve().parent.parent / "eye_provider"
PORT = 8779

sys.path.insert(0, str(HERMES_REPO))

FAIL = 0


def check(label, ok, detail=""):
    global FAIL
    if not ok:
        FAIL += 1
    print(f"[{'PASS' if ok else 'FAIL'}] {label}" + (f" — {detail}" if detail else ""))


def http(method, path, token=None, body=None, port=PORT):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Content-Type": "application/json",
                 **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def rpc(token, method, **params):
    status, body = http("POST", "/rpc", token, {"method": method, "params": params})
    assert status == 200, f"rpc {method} → {status}: {body}"
    return body


def snapshot(db_path):
    """Full-table snapshot. memory_banks.updated_at is excluded: banks are
    derived state and their rebuild timestamp is cache metadata, not part
    of the I4 byte-identity contract (vector bytes ARE compared)."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    out = {}
    for t, o in (("facts", "fact_id"), ("entities", "entity_id"),
                 ("fact_entities", "fact_id, entity_id"), ("memory_banks", "bank_name")):
        rows = []
        for r in conn.execute(f"SELECT * FROM {t} ORDER BY {o}"):
            d = {k: (base64.b64encode(v).decode() if isinstance(v, bytes) else v)
                 for k, v in dict(r).items()}
            if t == "memory_banks":
                d.pop("updated_at", None)
            rows.append(d)
        out[t] = rows
    conn.close()
    return out


def ws_connect(token, port=PORT):
    s = socket.create_connection(("127.0.0.1", port), timeout=10)
    key = base64.b64encode(os.urandom(16)).decode()
    s.sendall((f"GET /events?token={token} HTTP/1.1\r\nHost: 127.0.0.1\r\n"
               f"Upgrade: websocket\r\nConnection: Upgrade\r\n"
               f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
    resp = b""
    while b"\r\n\r\n" not in resp:
        resp += s.recv(4096)
    assert b"101" in resp.split(b"\r\n")[0], resp[:200]
    return s


def ws_recv_text(s, timeout=5.0):
    s.settimeout(timeout)
    def rd(n):
        b = b""
        while len(b) < n:
            c = s.recv(n - len(b))
            if not c:
                raise ConnectionResetError
            b += c
        return b
    b1, b2 = rd(2)
    n = b2 & 0x7F
    if n == 126:
        import struct
        n = struct.unpack(">H", rd(2))[0]
    elif n == 127:
        import struct
        n = struct.unpack(">Q", rd(8))[0]
    return rd(n).decode()


def main(tmp: Path):
    from plugins.memory.holographic import HolographicMemoryProvider
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "holographic_eye_verify", str(EYE_DIR / "__init__.py"),
        submodule_search_locations=[str(EYE_DIR)])
    eye_mod = importlib.util.module_from_spec(spec)
    sys.modules["holographic_eye_verify"] = eye_mod
    spec.loader.exec_module(eye_mod)

    db = tmp / "eye.db"
    src = sqlite3.connect(f"file:{LIVE_DB}?mode=ro", uri=True)
    dst = sqlite3.connect(str(db))
    src.backup(dst)
    src.close(); dst.close()

    inner = HolographicMemoryProvider(config={"db_path": str(db)})
    wrapped = eye_mod.EyeMemoryProvider(
        config={"journal_path": str(tmp / "journal.db"), "mode": "journal",
                # auto policy hosts the plane only in `hermes gateway run`
                # (port-theft fix) — the harness must opt in explicitly
                "control_plane": "always",
                "port": PORT}, inner=inner)
    wrapped.initialize("p2-verify")
    token = wrapped._control.token
    time.sleep(0.2)

    # I8 — auth + loopback
    check("I8 /health open", http("GET", "/health")[0] == 200)
    check("I8 /stats no token → 401", http("GET", "/stats")[0] == 401)
    check("I8 /stats bad token → 401", http("GET", "/stats", "nope")[0] == 401)
    st, stats = http("GET", "/stats", token)
    check("I8 /stats good token", st == 200 and stats.get("facts", 0) > 0,
          f"{stats.get('facts')} facts")
    lan_ok = True
    try:
        hostname_ip = socket.gethostbyname(socket.gethostname())
        if hostname_ip and not hostname_ip.startswith("127."):
            try:
                socket.create_connection((hostname_ip, PORT), timeout=1).close()
                lan_ok = False
            except OSError:
                pass
    except OSError:
        pass
    check("I8 external bind refused", lan_ok)

    # I6 — byte-equivalence RPC vs agent tool call
    cases = [
        ("search", {"query": "hermes gateway telegram"}),
        ("probe", {"entity": "Hermes Agent", "limit": 5}),
        ("related", {"entity": "Nexus Agent", "limit": 5}),
        ("reason", {"entities": ["Hermes Agent", "Nexus Agent"], "limit": 5}),
        ("contradict", {"limit": 3}),
        ("list", {"limit": 5}),
    ]
    bad = 0
    for action, args in cases:
        agent_raw = inner.handle_tool_call("fact_store", {"action": action, **args})
        rpc_raw = rpc(token, action, **args)["raw"]
        if agent_raw != rpc_raw:
            bad += 1
    check("I6 RPC reads byte-equivalent", bad == 0, f"{len(cases)} methods")

    # I7 — WS event latency + client-kill safety
    ws = ws_connect(token)
    hello = json.loads(ws_recv_text(ws))
    check("WS hello with stats", hello["type"] == "hello")
    t0 = time.perf_counter()
    r = rpc(token, "fact.add", content="P2 verification fact: 'Blossom' colors the Eye.",
            category="general", tags="verify")
    ev = json.loads(ws_recv_text(ws))
    dt = (time.perf_counter() - t0) * 1000
    check("WS event visible < 250ms", ev["type"] == "event" and dt < 250, f"{dt:.0f}ms")
    add_event_id = r["event_id"]
    ws.close()  # abrupt client death
    time.sleep(0.3)
    check("I7 provider fine after WS kill",
          json.loads(inner.handle_tool_call("fact_store",
              {"action": "list", "limit": 1}))["count"] == 1)

    # I4 — undo round-trips: every mutation kind, full-table diff
    u = rpc(token, "undo", event_id=add_event_id)
    check("I4 undo(fact.add)", u.get("ok"), str(u.get("error", "")))

    s0 = snapshot(db)
    target = json.loads(rpc(token, "list", limit=1)["raw"])["facts"][0]["fact_id"]

    def undo_roundtrip(label, mutate):
        res = mutate()
        ok = res.get("ok") and res.get("event_id")
        if not ok:
            check(f"I4 {label}", False, f"mutation failed: {res}")
            return
        rpc(token, "undo", event_id=res["event_id"])
        same = snapshot(db) == s0
        check(f"I4 undo({label}) byte-identical", same)

    undo_roundtrip("fact.add", lambda: rpc(
        token, "fact.add", content="Undo probe fact mentions 'Krkkonos Giant'.",
        category="tool", tags="verify"))
    undo_roundtrip("fact.update", lambda: rpc(
        token, "fact.update", fact_id=target,
        content="Edited by the Eye for undo verification with PyCharm Verification.",
        category="project", tags="verify,edited"))
    undo_roundtrip("fact.remove", lambda: rpc(token, "fact.remove", fact_id=target))
    undo_roundtrip("fact.trust_set", lambda: rpc(
        token, "fact.trust_set", fact_id=target, trust=0.85))
    undo_roundtrip("fact.feedback", lambda: rpc(
        token, "fact.feedback", fact_id=target, helpful=True))

    ents = rpc(token, "entities.list", limit=6)["entities"]
    two = [e for e in ents if e["fact_count"] > 0][:2]
    if len(two) == 2:
        undo_roundtrip("entity.merge", lambda: rpc(
            token, "entity.merge", src_id=two[1]["entity_id"],
            dst_id=two[0]["entity_id"]))
        undo_roundtrip("entity.alias", lambda: rpc(
            token, "entity.alias", entity_id=two[0]["entity_id"],
            name=two[0]["name"] + " Renamed"))
        undo_roundtrip("entity.remove", lambda: rpc(
            token, "entity.remove", entity_id=two[1]["entity_id"]))
    undo_roundtrip("backfill_vectors", lambda: rpc(token, "backfill_vectors"))

    # P4 — preview matches actual commit
    pv = rpc(token, "fact.preview_update", fact_id=target,
             content="Preview check: the Verification Project meets 'pytest'.")
    committed = rpc(token, "fact.update", fact_id=target,
                    content="Preview check: the Verification Project meets 'pytest'.")
    actual = {l["name"] for l in committed["fact"]["links"]}
    predicted = {p["name"] for p in pv["predicted_entities"]}
    check("P4 preview entities == actual commit", predicted == actual,
          f"{sorted(predicted)}")
    rpc(token, "undo", event_id=committed["event_id"])
    check("P4 post-undo state clean", snapshot(db) == s0)

    # Q6 — projection sanity: entity-sharing pairs closer than random pairs
    proj = rpc(token, "field.projection")
    facts = [f for f in proj["facts"] if f["x"] is not None]
    check("field.projection covers vectors",
          len(facts) >= stats["facts"] - stats["null_vectors"],
          f"{len(facts)} placed, ev={proj['meta'].get('explained_variance')}")
    import itertools, random
    random.seed(2)
    by_ent = {}
    for f in facts:
        for e in f["entities"]:
            by_ent.setdefault(e.lower(), []).append(f)
    share = []
    for group in by_ent.values():
        for a, b in itertools.combinations(group[:6], 2):
            share.append(((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2) ** 0.5)
    rand = []
    for _ in range(max(len(share), 500)):
        a, b = random.sample(facts, 2)
        rand.append(((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2) ** 0.5)
    ratio = (sum(share) / len(share)) / (sum(rand) / len(rand)) if share else 9
    check("Q6 entity-sharing pairs closer than chance", ratio < 1.0,
          f"mean dist ratio {ratio:.3f} over {len(share)} sharing pairs")

    # P5 — reason.explain ranking == retriever.reason; spectrum shape
    expl = rpc(token, "reason.explain",
               entities=["Hermes Agent", "Nexus Agent"], limit=5)
    direct = inner._retriever.reason(["Hermes Agent", "Nexus Agent"], limit=5)
    check("P5 explain ranking == reason()",
          [f["fact_id"] for f in expl["results"]] == [f["fact_id"] for f in direct])
    spec_r = rpc(token, "fact.spectrum", fact_id=target,
                 entities=["Hermes Agent"], banks=["general"])
    check("P5 spectrum traces + composition",
          spec_r.get("ok") and len(spec_r["traces"]) >= 2
          and len(spec_r["traces"][0]["bins"]) == spec_r["dim"]
          and spec_r["composition"],
          f"{len(spec_r.get('traces', []))} traces")

    wrapped.shutdown()


if __name__ == "__main__":
    os.environ.setdefault("HERMES_HOME", tempfile.mkdtemp(prefix="eye-p2-home-"))
    with tempfile.TemporaryDirectory(prefix="eye-p2-") as tmp:
        main(Path(tmp))
    print("\n" + ("ALL CHECKS PASSED" if FAIL == 0 else f"{FAIL} CHECK(S) FAILED"))
    sys.exit(1 if FAIL else 0)
