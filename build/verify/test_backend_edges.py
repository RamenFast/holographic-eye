"""Offline backend edge and database-safety tests for Holographic Eye.

This suite creates only synthetic SQLite databases under temporary directories.
It never opens ``~/.hermes/memory_store.db`` or ``~/.hermes/eye_journal.db``.
Every check states the required safe behavior and fails on a regression.

Run with the Hermes environment:
    ~/.hermes/hermes-agent/venv/bin/python build/verify/test_backend_edges.py -v
"""

from __future__ import annotations

import importlib.util
import json
import os
import sqlite3
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

REPO = Path(__file__).resolve().parents[2]
EYE_DIR = REPO / "build" / "eye_provider"
HERMES_REPO = Path(os.environ.get("HERMES_REPO", "~/.hermes/hermes-agent")).expanduser()
sys.path.insert(0, str(HERMES_REPO))


def load_eye():
    name = "holographic_eye_backend_edges"
    if name in sys.modules:
        return sys.modules[name]
    spec = importlib.util.spec_from_file_location(
        name, EYE_DIR / "__init__.py", submodule_search_locations=[str(EYE_DIR)]
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


EYE = load_eye()


class Plane:
    def __init__(self, provider):
        self.provider = provider

    def active_provider(self):
        return self.provider

    def stats(self):
        return {}


class BackendEdges(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="holo-eye-edge-")
        self.backup_tmp = tempfile.TemporaryDirectory(
            prefix=".holo-eye-backup-", dir=REPO / "build" / "verify"
        )
        self.root = Path(self.tmp.name).resolve()
        self.backup_root = Path(self.backup_tmp.name).resolve()
        self.db = self.root / "memory.db"
        self.journal = self.root / "journal.db"
        from plugins.memory.holographic import HolographicMemoryProvider

        inner = HolographicMemoryProvider(
            config={"db_path": str(self.db), "hrr_dim": 64}
        )
        self.provider = EYE.EyeMemoryProvider(
            config={
                "journal_path": str(self.journal),
                "mode": "journal",
                "control_plane": "never",
                "accel": False,
            },
            inner=inner,
        )
        self.provider.initialize("edge-test")
        self.plane = Plane(self.provider)
        self.rpc = importlib.import_module(EYE.__name__ + ".rpc")
        self.mutations = importlib.import_module(EYE.__name__ + ".mutations")
        self.backup = importlib.import_module(EYE.__name__ + ".backup")
        self.assertTrue(self.db.resolve().is_relative_to(self.root))
        self.assertTrue(self.journal.resolve().is_relative_to(self.root))

    def tearDown(self):
        self.provider.shutdown()
        self.tmp.cleanup()
        self.backup_tmp.cleanup()

    def call(self, method, **params):
        return self.rpc.dispatch(self.plane, method, params)

    def content(self, fact_id):
        row = self.provider.store._conn.execute(
            "SELECT content FROM facts WHERE fact_id = ?", (fact_id,)
        ).fetchone()
        return row["content"] if row else None

    def test_empty_store_reads_are_total(self):
        self.assertEqual(self.call("list", limit=10)["raw"], '{"facts": [], "count": 0}')
        self.assertEqual(self.call("entities.list")["entities"], [])
        projection = self.call("field.projection", refit=True)
        self.assertTrue(projection["ok"])
        self.assertEqual(projection["facts"], [])
        self.assertEqual(projection["meta"]["n_vectors"], 0)
        self.assertEqual(
            self.provider.store._conn.execute("PRAGMA integrity_check").fetchone()[0],
            "ok",
        )

    def test_singleton_store_projects_a_visible_origin(self):
        added = self.call("fact.add", content="Singleton snowflake 雪", category="general")
        projection = self.call("field.projection", refit=True)
        fact = next(f for f in projection["facts"] if f["fact_id"] == added["fact_id"])
        self.assertEqual((fact["x"], fact["y"]), (0.0, 0.0))

    def test_projection_cache_is_isolated_per_database(self):
        for content in ("alpha one", "alpha two", "alpha three"):
            self.call("fact.add", content=content)
        first = self.call("field.projection", refit=True)
        first_xy = [(fact["x"], fact["y"]) for fact in first["facts"]]

        from plugins.memory.holographic import HolographicMemoryProvider
        other = EYE.EyeMemoryProvider(
            config={
                "journal_path": str(self.root / "other-journal.db"),
                "control_plane": "never",
                "accel": False,
            },
            inner=HolographicMemoryProvider(
                config={"db_path": str(self.root / "other-memory.db"), "hrr_dim": 64}
            ),
        )
        other.initialize("other-edge-test")
        try:
            other_plane = Plane(other)
            for content in ("zeta red", "zeta green", "zeta blue"):
                self.rpc.dispatch(other_plane, "fact.add", {"content": content})
            second = self.rpc.dispatch(other_plane, "field.projection", {"refit": True})
            self.assertTrue(second["meta"]["fitted"])
            first_again = self.call("field.projection")
        finally:
            other.shutdown()

        self.assertFalse(first_again["meta"]["fitted"])
        self.assertEqual(
            [(fact["x"], fact["y"]) for fact in first_again["facts"]], first_xy
        )

    def test_unicode_large_payload_round_trips_and_undoes_cleanly(self):
        content = ("雪🌸 café Δοκιμή ") * 2000
        added = self.call("fact.add", content=content, category="unicode", tags="雪,🌸")
        self.assertTrue(added["ok"])
        fact_id = added["fact_id"]
        got = self.call("fact.get", fact_id=fact_id, include_vector=True)["fact"]
        self.assertEqual(got["content"], content.strip())
        self.assertTrue(got["hrr_vector_b64"])
        undone = self.call("undo", event_id=added["event_id"])
        self.assertTrue(undone["ok"])
        self.assertIsNone(self.content(fact_id))
        self.assertEqual(
            self.provider.store._conn.execute("PRAGMA integrity_check").fetchone()[0],
            "ok",
        )
        event = self.provider.journal.get_event(added["event_id"])
        self.assertEqual(event["undone_by"], undone["event_id"])
        self.assertIn("雪🌸", event["request"])

    def test_duplicate_add_refuses_destructive_undo(self):
        first = self.call("fact.add", content="Duplicate fact", category="general")
        duplicate = self.call("fact.add", content="Duplicate fact", category="general")
        self.assertTrue(duplicate["deduped"])
        result = self.call("undo", event_id=duplicate["event_id"])
        self.assertFalse(result["ok"])
        self.assertEqual(self.content(first["fact_id"]), "Duplicate fact")

    def test_malformed_params_return_structured_errors_without_mutation(self):
        before = self.provider.store._conn.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
        cases = [
            ("fact.get", {}),
            ("fact.get", {"fact_id": "not-an-int"}),
            ("fact.add", {"content": []}),
            ("fact.update", {"fact_id": "not-an-int", "content": "x"}),
            ("entity.get", {}),
            ("journal.tail", {"limit": "many"}),
            ("reason.explain", {"entities": ["雪"], "limit": "many"}),
        ]
        defects = []
        for method, params in cases:
            try:
                result = self.rpc.dispatch(self.plane, method, params)
            except Exception as exc:
                defects.append(f"{method}: raised {type(exc).__name__}")
            else:
                if result.get("ok") is not False or not result.get("error"):
                    defects.append(f"{method}: unstructured {result!r}")
        after = self.provider.store._conn.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
        self.assertEqual(after, before)
        self.assertEqual(defects, [])

    def test_mutation_validation_rejects_ambiguous_types_before_database_calls(self):
        added = self.call("fact.add", content="validation baseline", tags="safe")
        fact_id = added["fact_id"]
        baseline = self.call("fact.get", fact_id=fact_id)["fact"]
        cases = [
            ("fact.update", {"fact_id": fact_id, "trust_delta": value})
            for value in ("NaN", "Infinity", "-Infinity", float("nan"),
                          float("inf"), float("-inf"), True)
        ] + [
            ("fact.update", {"fact_id": True, "content": "must not rewrite id one"}),
            ("fact.update", {"fact_id": fact_id}),
            ("fact.update", {"fact_id": fact_id, "tags": []}),
            ("fact.update", {"fact_id": fact_id, "tags": {}}),
            ("fact.add", {"content": "bad tags list", "tags": []}),
            ("fact.add", {"content": "bad tags object", "tags": {}}),
        ]
        with (
            mock.patch.object(self.provider.store, "update_fact",
                              wraps=self.provider.store.update_fact) as update_call,
            mock.patch.object(self.provider.store, "add_fact",
                              wraps=self.provider.store.add_fact) as add_call,
        ):
            for method, params in cases:
                with self.subTest(method=method, params=repr(params)):
                    result = self.rpc.dispatch(self.plane, method, params)
                    self.assertFalse(result["ok"], result)
                    self.assertIn("error", result)
            update_call.assert_not_called()
            add_call.assert_not_called()
        entity_id = self.call("fact.add", content='validation links "Typed Entity"')["fact_id"]
        entity = self.call("fact.get", fact_id=entity_id)["fact"]["links"][0]
        with mock.patch.object(
            self.mutations, "entity_alias", wraps=self.mutations.entity_alias
        ) as alias_call:
            bad_alias = self.call("entity.alias", entity_id=entity["entity_id"], name=[])
            self.assertFalse(bad_alias["ok"], bad_alias)
            alias_call.assert_not_called()
        after = self.call("fact.get", fact_id=fact_id)["fact"]
        self.assertEqual(after, baseline)
        names = [row[0] for row in self.provider.store._conn.execute(
            "SELECT name FROM entities WHERE entity_id = ?", (entity["entity_id"],)
        )]
        self.assertEqual(names, [entity["name"]])

    def test_valid_numeric_trust_delta_remains_supported(self):
        added = self.call("fact.add", content="valid numeric delta")
        updated = self.call("fact.update", fact_id=added["fact_id"], trust_delta=0.2)
        self.assertTrue(updated["ok"], updated)
        self.assertAlmostEqual(updated["fact"]["trust_score"], 0.7)

    def test_append_loss_returns_committed_unjournaled_error(self):
        with mock.patch.object(self.provider, "_append", return_value=None):
            result = self.call("fact.add", content="append loss fact")
        self.assertFalse(result["ok"], result)
        self.assertTrue(result["committed"])
        self.assertFalse(result["journaled"])
        self.assertIsNone(result["event_id"])
        self.assertIsNotNone(self.content(result["fact_id"]))

    def test_invalid_entity_name_is_not_a_like_wildcard(self):
        self.call("fact.add", content='First links "Alpha"', category="general")
        self.call("fact.add", content='Second links "Beta"', category="general")
        result = self.call("entity.get", name="%")
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "entity not found")


    def test_malformed_mutation_types_do_not_coerce_or_change_trust(self):
        added = self.call("fact.add", content="Trust type check")
        fact_id = added["fact_id"]
        baseline = self.call("fact.get", fact_id=fact_id)["fact"]
        trust_result = self.call("fact.trust_set", fact_id=fact_id, trust="NaN")
        feedback_result = self.call("fact.feedback", fact_id=fact_id, helpful="false")
        empty_result = self.call("fact.update", fact_id=fact_id, content="   ")
        after = self.call("fact.get", fact_id=fact_id)["fact"]
        self.assertFalse(trust_result["ok"])
        self.assertFalse(feedback_result["ok"])
        self.assertFalse(empty_result["ok"])
        self.assertEqual(after["content"], baseline["content"])
        self.assertEqual(after["trust_score"], baseline["trust_score"])
        self.assertEqual(after["helpful_count"], baseline["helpful_count"])

    def test_svd_thread_cap_is_scoped_and_coordinate_exact(self):
        from plugins.memory.holographic import holographic as hrr
        from threadpoolctl import threadpool_info
        import numpy as np

        for content in ("svd north", "svd south", "svd east", "svd west"):
            self.call("fact.add", content=content)
        before_threads = [
            (row.get("internal_api"), row.get("prefix"), row.get("num_threads"))
            for row in threadpool_info()
        ]
        projected = self.call("field.projection", refit=True)
        after_threads = [
            (row.get("internal_api"), row.get("prefix"), row.get("num_threads"))
            for row in threadpool_info()
        ]
        self.assertEqual(projected["meta"]["svd_threads"], 2)
        self.assertEqual(after_threads, before_threads)

        rows = self.provider.store._conn.execute(
            "SELECT fact_id, hrr_vector FROM facts ORDER BY fact_id"
        ).fetchall()
        phases = np.stack([hrr.bytes_to_phases(row["hrr_vector"]) for row in rows])
        matrix = np.concatenate([np.cos(phases), np.sin(phases)], axis=1)
        centered = matrix - matrix.mean(axis=0)
        _, _, vt = np.linalg.svd(centered, full_matrices=False)
        components = vt[:2].copy()
        for index in range(2):
            pivot = int(np.argmax(np.abs(components[index])))
            if components[index][pivot] < 0:
                components[index] = -components[index]
        raw_xy = centered @ components.T
        expected = {
            row["fact_id"]: (round(float(x), 5), round(float(y), 5))
            for row, (x, y) in zip(rows, raw_xy)
        }
        actual = {fact["fact_id"]: (fact["x"], fact["y"]) for fact in projected["facts"]}
        self.assertEqual(actual, expected)

    def test_svd_thread_cap_optional_fallback_keeps_same_math(self):
        import builtins
        import numpy as np

        explain = importlib.import_module(EYE.__name__ + ".explain")
        matrix = np.arange(48, dtype=np.float64).reshape(6, 8)
        expected = np.linalg.svd(matrix, full_matrices=False)
        real_import = builtins.__import__

        def without_threadpoolctl(name, *args, **kwargs):
            if name == "threadpoolctl":
                raise ImportError("synthetic optional dependency miss")
            return real_import(name, *args, **kwargs)

        with mock.patch("builtins.__import__", side_effect=without_threadpoolctl):
            actual, cap = explain._svd(np, matrix)
        self.assertIsNone(cap)
        for got, wanted in zip(actual, expected):
            self.assertTrue(np.allclose(got, wanted))

    def test_cold_full_size_projection_finishes_within_budget(self):
        from plugins.memory.holographic import HolographicMemoryProvider
        from plugins.memory.holographic import holographic as hrr
        import numpy as np

        provider = EYE.EyeMemoryProvider(
            config={
                "journal_path": str(self.root / "benchmark-journal.db"),
                "control_plane": "never",
                "accel": False,
            },
            inner=HolographicMemoryProvider(
                config={"db_path": str(self.root / "benchmark-memory.db"), "hrr_dim": 1024}
            ),
        )
        provider.initialize("benchmark-edge-test")
        try:
            base = np.arange(1024, dtype=np.float64) * 0.001
            rows = [
                (f"synthetic projection row {index}", "benchmark", "", 0.5,
                 hrr.phases_to_bytes((base + index * 0.013) % (2 * np.pi)))
                for index in range(540)
            ]
            provider.store._conn.executemany(
                "INSERT INTO facts (content, category, tags, trust_score, hrr_vector) "
                "VALUES (?, ?, ?, ?, ?)",
                rows,
            )
            started = time.perf_counter()
            projection = self.rpc.dispatch(Plane(provider), "field.projection", {"refit": True})
            elapsed = time.perf_counter() - started
        finally:
            provider.shutdown()
        self.assertTrue(projection["ok"])
        self.assertEqual(len(projection["facts"]), 540)
        self.assertEqual(projection["meta"]["svd_threads"], 2)
        self.assertLess(elapsed, 5.0, f"cold projection took {elapsed:.3f}s")
        print(f"[BENCH] cold 540x1024 projection: {elapsed * 1000:.1f}ms")

    def test_provider_instances_share_operation_lock_by_database(self):
        from plugins.memory.holographic import HolographicMemoryProvider
        other = EYE.EyeMemoryProvider(
            config={
                "journal_path": str(self.root / "other-shared-journal.db"),
                "control_plane": "never",
                "accel": False,
            },
            inner=HolographicMemoryProvider(
                config={"db_path": str(self.db), "hrr_dim": 64}
            ),
        )
        other.initialize("other-same-db")
        try:
            self.assertIs(other._operation_lock, self.provider._operation_lock)
        finally:
            other.shutdown()

    def test_concurrent_tool_journals_have_linear_before_images(self):
        added = self.call("fact.add", content="concurrency base")
        fact_id = added["fact_id"]
        barrier = threading.Barrier(2)
        original_delegate = self.provider._inner.handle_tool_call

        def delegate_after_sync(tool_name, args, **kwargs):
            if tool_name == "fact_store" and args.get("action") == "update":
                try:
                    barrier.wait(timeout=0.3)
                except threading.BrokenBarrierError:
                    pass
            return original_delegate(tool_name, args, **kwargs)

        errors = []

        def update(content):
            try:
                self.provider.handle_tool_call(
                    "fact_store", {"action": "update", "fact_id": fact_id, "content": content}
                )
            except Exception as exc:
                errors.append(exc)

        with mock.patch.object(
            self.provider._inner, "handle_tool_call", side_effect=delegate_after_sync
        ):
            threads = [
                threading.Thread(target=update, args=("concurrency one",)),
                threading.Thread(target=update, args=("concurrency two",)),
            ]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=10)

        self.assertEqual(errors, [])
        events = [
            event for event in self.provider.journal.get_events(limit=100, newest_first=False)
            if event["source"] == "tool" and event["kind"] == "update"
        ]
        self.assertEqual(len(events), 2)
        before_contents = [json.loads(event["before"])["facts"][0]["content"] for event in events]
        self.assertEqual(len(set(before_contents)), 2)
        self.assertEqual(
            self.provider.store._conn.execute("PRAGMA integrity_check").fetchone()[0], "ok"
        )

    def test_undo_rejects_same_value_later_event(self):
        added = self.call("fact.add", content="same value trust")
        first = self.call("fact.trust_set", fact_id=added["fact_id"], trust=0.7)
        later = self.call("fact.trust_set", fact_id=added["fact_id"], trust=0.7)
        result = self.call("undo", event_id=first["event_id"])
        self.assertFalse(result["ok"], result)
        self.assertIn(str(later["event_id"]), result["error"])
        self.assertAlmostEqual(
            self.call("fact.get", fact_id=added["fact_id"])["fact"]["trust_score"], 0.7
        )

    def test_undo_rejects_b_to_c_to_b_aba(self):
        added = self.call("fact.add", content="state B")
        self.call("fact.update", fact_id=added["fact_id"], content="state C")
        later = self.call("fact.update", fact_id=added["fact_id"], content="state B")
        result = self.call("undo", event_id=added["event_id"])
        self.assertFalse(result["ok"], result)
        self.assertIn("later event", result["error"])
        self.assertEqual(self.content(added["fact_id"]), "state B")

    def test_undo_identity_does_not_depend_on_timestamps(self):
        added = self.call("fact.add", content="timestamp identity")
        self.provider.store._conn.execute(
            "UPDATE facts SET updated_at = '2099-01-01 00:00:00' WHERE fact_id = ?",
            (added["fact_id"],),
        )
        result = self.call("undo", event_id=added["event_id"])
        self.assertTrue(result["ok"], result)
        self.assertIsNone(self.content(added["fact_id"]))

    def test_reverse_order_undo_ignores_completed_later_pair(self):
        added = self.call("fact.add", content="reverse B")
        changed = self.call("fact.update", fact_id=added["fact_id"], content="reverse C")
        undo_changed = self.call("undo", event_id=changed["event_id"])
        self.assertTrue(undo_changed["ok"], undo_changed)
        undo_added = self.call("undo", event_id=added["event_id"])
        self.assertTrue(undo_added["ok"], undo_added)
        self.assertIsNone(self.content(added["fact_id"]))

    def test_old_event_undo_rejects_newer_fact_state(self):
        added = self.call("fact.add", content="version zero", category="general")
        first = self.call("fact.update", fact_id=added["fact_id"], content="version one")
        second = self.call("fact.update", fact_id=added["fact_id"], content="version two")
        result = self.call("undo", event_id=first["event_id"])
        self.assertFalse(result["ok"])
        self.assertIn("undo rejected", result["error"])
        self.assertEqual(self.content(added["fact_id"]), "version two")
        self.assertIsNone(self.provider.journal.get_event(first["event_id"])["undone_by"])
        self.assertIsNone(self.provider.journal.get_event(second["event_id"])["undone_by"])

    def test_eye_mutation_is_rejected_when_journal_is_unavailable(self):
        journal = self.provider._journal
        self.provider._journal = None
        try:
            result = self.call("fact.add", content="must remain auditable")
        finally:
            self.provider._journal = journal
        self.assertFalse(result["ok"])
        count = self.provider.store._conn.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
        self.assertEqual(count, 0)

        journal.close()
        self.provider._journal = journal
        closed_result = self.call("fact.add", content="closed journal must also reject")
        self.assertFalse(closed_result["ok"])
        count = self.provider.store._conn.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
        self.assertEqual(count, 0)

    def test_agent_delegation_continues_when_journal_is_unavailable(self):
        journal = self.provider._journal
        self.provider._journal = None
        try:
            raw = self.provider.handle_tool_call(
                "fact_store", {"action": "add", "content": "agent must keep writing"}
            )
        finally:
            self.provider._journal = journal
        fact_id = json.loads(raw)["fact_id"]
        self.assertEqual(self.content(fact_id), "agent must keep writing")

    def test_fact_register_survives_update_and_undo(self):
        store = self.provider.store
        store._conn.execute(
            """CREATE TABLE fact_register (
                   fact_id INTEGER PRIMARY KEY REFERENCES facts(fact_id),
                   register_affinity TEXT NOT NULL,
                   method TEXT NOT NULL,
                   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
               )"""
        )
        added = self.call("fact.add", content="registered fact")
        store._conn.execute(
            "INSERT INTO fact_register (fact_id, register_affinity, method) VALUES (?, ?, ?)",
            (added["fact_id"], "episodic", "synthetic"),
        )
        updated = self.call(
            "fact.update", fact_id=added["fact_id"], content="registered fact updated"
        )
        undone = self.call("undo", event_id=updated["event_id"])
        self.assertTrue(undone["ok"], undone)
        register = store._conn.execute(
            "SELECT register_affinity, method FROM fact_register WHERE fact_id = ?",
            (added["fact_id"],),
        ).fetchone()
        self.assertEqual(tuple(register), ("episodic", "synthetic"))

    def test_entity_edit_rolls_back_when_vector_refresh_fails(self):
        added = self.call("fact.add", content='Rollback links "Alpha Entity"')
        entity_id = self.call("fact.get", fact_id=added["fact_id"])["fact"]["links"][0]["entity_id"]
        before = self.call("entity.get", entity_id=entity_id)["entity"]
        with mock.patch.object(
            self.mutations, "_reencode_facts", side_effect=RuntimeError("injected refresh fault")
        ):
            try:
                result = self.call("entity.alias", entity_id=entity_id, name="Changed Entity")
            except RuntimeError as exc:
                result = {"ok": False, "error": str(exc)}
        after = self.call("entity.get", entity_id=entity_id)["entity"]
        self.assertFalse(result["ok"])
        self.assertEqual(after["name"], before["name"])
        events = self.provider.journal.get_events(sources=["eye"], limit=100)
        self.assertFalse(any(e["kind"] == "entity.alias" for e in events))

    def test_backup_append_loss_is_not_reported_as_success(self):
        with mock.patch.object(self.provider, "_append", return_value=None):
            result = self.call(
                "backup.create", dest_dir=str(self.backup_root / "append-loss-backup")
            )
        self.assertFalse(result["ok"], result)
        self.assertTrue(result["committed"])
        self.assertFalse(result["journaled"])
        self.assertTrue(Path(result["path"]).is_dir())

    def test_backup_memory_and_journal_form_one_consistent_cut(self):
        memory_done = threading.Event()
        release_memory = threading.Event()
        mutation_done = threading.Event()
        original_snapshot = self.backup._snapshot

        def paused_snapshot(src, dst):
            size = original_snapshot(src, dst)
            if Path(src) == Path(self.provider.store.db_path):
                memory_done.set()
                release_memory.wait(timeout=5)
            return size

        result = {}
        backup_root = self.backup_root / "backups"
        backup_errors = []

        def make_backup():
            try:
                result.update(self.backup.backup_create(
                    self.provider, {"dest_dir": str(backup_root), "label": "cut"}
                ))
            except Exception as exc:
                backup_errors.append(exc)

        def mutate():
            self.call("fact.add", content="concurrent backup write")
            mutation_done.set()

        with mock.patch.object(self.backup, "_snapshot", side_effect=paused_snapshot):
            backup_thread = threading.Thread(target=make_backup)
            backup_thread.start()
            self.assertTrue(memory_done.wait(timeout=5))
            mutation_thread = threading.Thread(target=mutate)
            mutation_thread.start()
            mutation_finished_before_release = mutation_done.wait(timeout=2)
            release_memory.set()
            backup_thread.join(timeout=10)
            mutation_thread.join(timeout=10)

        self.assertEqual(backup_errors, [])
        self.assertTrue(result.get("ok"), result)
        folder = Path(result["path"])
        with sqlite3.connect(folder / "memory_store.db") as conn:
            memory_facts = conn.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
        with sqlite3.connect(folder / "eye_journal.db") as conn:
            journal_adds = conn.execute(
                "SELECT COUNT(*) FROM events WHERE source='eye' AND kind='fact.add'"
            ).fetchone()[0]
        self.assertFalse(mutation_finished_before_release)
        self.assertEqual(memory_facts, journal_adds)
        self.assertEqual(result["manifest"]["facts"], memory_facts)


if __name__ == "__main__":
    unittest.main(verbosity=2)
