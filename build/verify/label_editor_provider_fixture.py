"""Synthetic editor RPC bridge. Run only with the Hermes project interpreter.

Reuses the offline backend fixture. No socket, live database, or service.
One JSON request per stdin line. stdout is a test-only response stream.
"""
from __future__ import annotations
import contextlib
import json
import sys
from test_backend_edges import BackendEdges


def main():
    case = BackendEdges(methodName="test_empty_store_reads_are_total")
    with contextlib.redirect_stdout(sys.stderr):
        case.setUp()
    try:
        with contextlib.redirect_stdout(sys.stderr):
            added = case.call("fact.add", content="Synthetic Garden editor memory", category="Custom Garden", tags="old, tags")
        print(json.dumps({"ready": True, "fact_id": added["fact_id"], "temporaryStore": True}), flush=True)
        allowed = {"fact.get", "fact.update", "fact.trust_set", "fact.preview_update", "field.projection", "entities.list", "journal.tail", "fact.spectrum", "undo"}
        for line in sys.stdin:
            request = json.loads(line)
            try:
                if request["method"] not in allowed:
                    raise ValueError("Method is outside the synthetic editor fixture")
                with contextlib.redirect_stdout(sys.stderr):
                    result = case.call(request["method"], **request.get("params", {}))
                print(json.dumps({"id": request["id"], "result": result}), flush=True)
            except Exception as error:
                print(json.dumps({"id": request["id"], "error": str(error)}), flush=True)
    finally:
        with contextlib.redirect_stdout(sys.stderr):
            case.tearDown()


if __name__ == "__main__":
    main()
