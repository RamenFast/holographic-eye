# ⊙ The Holographic Eye

Glass cockpit for the Hermes `holographic` memory provider — watch the agent's
memory live as its **real HRR geometry**, curate trust, review/undo every write,
merge junk entities, back it all up, and ask the agent itself to revise its
memory. Zero Hermes core changes.

**Source of truth: [`PLAN.md`](PLAN.md)** (🫀Fi vision + 🧠Ti spec, single file).
Everything under `build/` is a compiled artifact — deletable, regenerable from
the PLAN. Decisions made while building were folded back into the PLAN the same
session. License: [GPLv3](LICENSE).

![mockup](mockup.html) <!-- open mockup.html for the P0 rendered mockup -->

## What's running

```
┌─ Hermes gateway (always-on) ────────────────────────────────┐
│  holographic-eye — wrapper MemoryProvider (out-of-tree)     │
│   ├─ delegates everything to the bundled provider (I2:     │
│   │  agent behavior is bit-identical to stock)             │
│   ├─ journals every op → ~/.hermes/eye_journal.db          │
│   │  with full before/after images (I3) → undo (I4)        │
│   └─ control plane 127.0.0.1:8770 (token in                │
│      ~/.hermes/eye_token) — HTTP RPC + WS events +         │
│      serves the GUI                                        │
└─────────────────────────────────────────────────────────────┘
```

| Piece | Where |
|---|---|
| Wrapper provider + journal + control plane | `build/eye_provider/` → deployed to `~/.hermes/plugins/holographic-eye/` |
| GUI (TS + Canvas2D, Blossom shell) | `build/eye_frontend/` → served at `http://127.0.0.1:8770/` |
| Tauri shell + `.deb` | `build/eye_shell/` |
| `/holo` slash command | `build/eye_commands/` → `~/.hermes/plugins/holographic-eye-commands/` |
| Icons (Blossom language) | `build/eye_icons/` |
| Acceptance harnesses | `build/verify/` |

## Daily use

- **GUI**: `hermes holographic-eye gui` (prints + opens the tokened URL), or the
  desktop app once the `.deb` is installed. Panes: **the Field** (PCA of the
  actual 1024-d phase vectors — entity-sharing facts sit at 0.31× random
  distance), Entities/Queue/Contradictions, Inspect (edit with server-computed
  preview, typed-ID delete, trust slider, feedback, undo), Stream footer
  (every op live: tool calls, prefetch injections, mirrors, auto-extracts).
- **Modals**: Reason Workbench (`⌘R` — previews *the recall, not the answer*),
  FFT inspector (`inspect algebra`), Backup Memory, Ask-the-agent.
- **CLI**: `hermes holographic-eye status | tail | undo-last | backup | gui`
- **In chat**: `/holo [n]` — status + last n journal events.

## Backup & restore (D-0007)

`backup` (GUI modal or CLI) snapshots `memory_store.db` + `eye_journal.db` with
the sqlite backup API (consistent while live) to
`/media/ben/Mass storage/agenticTinkering/claude/holographic-eye-backups/`
(fallback `~/.hermes/backups/holographic-eye/`), with a `manifest.json`.

**Restore is deliberately cold** (never hot-swap a WAL db):
```
hermes gateway stop
cp <backup>/memory_store.db <backup>/eye_journal.db ~/.hermes/
hermes gateway start
```

## Recompile / redeploy

```
cd build/eye_frontend && npm install && npm run build   # GUI bundle
./build/deploy.sh                                       # provider + GUI + /holo
hermes gateway restart                                  # server-side code changes
                                                        # (loader pre-imports all
                                                        # plugin submodules)
python3 build/eye_icons/make_icons.py                   # icons
cd build/eye_shell/src-tauri && cargo tauri build --bundles deb
```

Rollback to stock: set `memory.provider: holographic` in `~/.hermes/config.yaml`,
restart the gateway. The journal and Eye files are inert when not selected.

## Invariants (all acceptance-tested — see `build/verify/`)

- **I1** zero diffs to Hermes core / bundled plugin (pure composition)
- **I2** agent-visible behavior bit-identical to stock (replay-verified)
- **I3** every mutation → exactly one journal event with before/after images
- **I4** `undo(event_id)` restores byte-identically (SQL-diff-verified for all
  9 mutation kinds)
- **I6** GUI reads are byte-equivalent to the agent's tool results
- **I7** Eye failure degrades to stock provider behavior; clients can die freely
- **I8** control plane is loopback + bearer token (LAN is an explicit opt-in)

*Compiled from PLAN.md by Claude (Fable 5), 2026-07-02 — with love for the math.*
