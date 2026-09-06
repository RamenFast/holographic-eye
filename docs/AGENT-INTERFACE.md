# Agent interface

## Native shell

Run `holographic-eye schema` for the executable contract.

| Command | Effect |
|---|---|
| No arguments | Open the native window |
| `version --json` | Installed shell version |
| `status --json` | Read-only attached-plane and token-file checks |
| `probe --json` | Alias of status |
| `help --json` | Usage and command summaries |
| `schema` | Structured interface and output schemas |

Piped output is one JSON object with `status`, `tool`, `version`, and ISO-8601 `ts`.
TTY output is text unless `--json` is present. Errors contain `error` and `fix`.
Exit codes are 0 success, 2 unavailable, 3 invalid arguments, and 4 runtime failure.
Token readability is not token authentication. No command prints the token.

## Existing provider interface

The user-level Hermes extension exposes `status`, `tail`, `undo-last`, `backup`, and `gui`.
The loopback control plane uses its existing `ok`/`error` API contract, not the native CLI envelope.
Do not mistake the two surfaces.

- `GET /health`: public liveness and attached-provider state.
- `GET /stats`: token-authenticated counts and runtime data.
- `POST /rpc`: token-authenticated `{method, params}`.
- `GET /events`: authenticated WebSocket with hello and journal event packets.

Read passthrough methods: `search`, `probe`, `related`, `reason`, `contradict`, `list`.
The response `raw` field contains the provider's own result string.
Structured reads include `fact.get`, `entities.list`, `entity.get`, `field.projection`,
`reason.explain`, `fact.spectrum`, and `journal.*`.
Mutation controls include `fact.*`, entity curation, `undo`, `backfill_vectors`, `backup.create`, and `agent.ask`.
Use the current dispatch source and `PLAN.md` for exact method parameters.

Do not send test mutations to a live database. A failed network response does not prove that a mutation failed.
The frontend reports uncertain outcomes and does not automatically retry them.

## Reproducible checks

Frontend: `npm --prefix build/eye_frontend run check` and `npm --prefix build/eye_frontend run build`.
Synthetic GUI: `node build/verify/gui_edge.cjs` after `npm --prefix build/verify ci`.
Geometry: `node build/eye_geometry/test.mjs` with pinned Zig 0.15.2.
Native: `cargo test` from `build/eye_shell/src-tauri`.
Provider: run `build/verify/test_backend_edges.py` with Hermes' supported `venv/bin/python`.

The GUI engine state is visible in Settings and through `window.eyeField.geometryStatus()`.
This reports actual loading/WASM/JavaScript state, not an assumed acceleration claim.

## Memory editor and lifecycle
The frontend uses existing `fact.preview_update`/`fact.update` for staged content/category/tags. Absolute trust uses a separate explicit `fact.trust_set`; neither slider movement nor preview writes memory. Derived counters, timestamps, vectors and register data remain read-only. Persistent engine configuration has no setter in this surface.
Drafts are page-local. Preflight checks are not a server lock, and a detail save is not a cross-database transaction. Unknown outcomes block automatic retries. Native close awaits an explicit draft decision through local WebKit evaluation; no remote IPC capability was added. Capacity Copy prompt only writes the clipboard.
