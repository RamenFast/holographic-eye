# HANDOFF — The Holographic Eye (as of 2026-07-03, end of session 2)

For the next session (any agent, or Ben). Source of truth is **PLAN.md**;
this file is the "where we are + what's next" pointer. Read PLAN's
"Status: BUILT & LIVE" header + PART 7 decision log (D-0001…D-0010).

## Current state (all live on Ben's machine)

| Thing | State |
|---|---|
| Wrapper provider | `memory.provider: holographic-eye`, live in the gateway since 2026-07-02; journal capturing everything (`~/.hermes/eye_journal.db`) |
| Control plane | `http://127.0.0.1:8770`, token `~/.hermes/eye_token`, serves the GUI. **Starts lazily on first agent message** — after a gateway restart, ping via api_server (:8642, key in `~/.hermes/.env`) if it's not listening |
| GUI | v3 deployed 2026-07-03: feedback round 2 fully applied (D-0010) — dirty-flag rendering (0 idle draws, was 60fps forever), multi-entity highlight set, chevron disclosure, lens toggle fix, one manual + honest ⚙ (text size, pixel-garden toggle), 6-species flowerbed + cottage |
| CLI / chat | `hermes holographic-eye status\|tail\|undo-last\|backup\|gui` · `/holo` on Telegram/CLI |
| Backups | D-0007; first backup on Mass storage; restore is cold-only (README) |
| api_server | enabled via `API_SERVER_KEY` in `~/.hermes/.env` (loopback :8642); asks land in the `eye-console` session |
| Acceptance | `build/verify/p1_equivalence.py` (15 checks) + `p2_control.py` (25 checks) — both ALL-PASS as of 2026-07-03. GUI affordances Playwright-verified against the live control plane (headless system Chrome + a `clearRect` draw counter) |

## Next session, in order

1. **Probe latency (top candidate)** — the *inner* provider's `probe()` takes
   ~4s per call on 518 facts: it re-runs `hrr.encode_text(fact.content)` for
   every fact on every probe
   (`~/.hermes/hermes-agent/plugins/memory/holographic/retrieval.py`, the
   loop at the bottom of `probe()`; `role_content` is even re-encoded inside
   the loop). A content-vector cache keyed by `(fact_id, updated_at)` — or
   persisting content vectors — would make entity clicks ~ms. **That's
   upstream hermes-agent code, not the wrapper**: decide whether to patch
   upstream locally (gateway restart + re-run verify harnesses) or file the
   deferred upstream PR. The GUI already narrates the wait honestly
   (mathlog "running…" line), so this is pure speed, not correctness.
2. Wait for Ben's feedback round 3; log it in `feedback/` with root causes
   the same way.
3. Fold anything new back into PLAN.md (D-0011…) — the discipline held for
   two sessions; keep it.

Deferred (unchanged): Q5 quarantine mode; junk-entity merging is Ben's call
via the Entity Desk; UMAP opt-in; upstream PR grooming.

## Gotchas that will bite you (learned the hard way)

- Discovery calls the provider's `register()` on every scan → constructor
  must stay cheap/side-effect-free.
- **Provider (and thus control plane) initializes lazily** — after a gateway
  restart, :8770 is down until the first agent message. A one-line chat via
  api_server wakes it (see above).
- CLI processes skip the control plane on purpose (port-theft; see PLAN
  Addendum 2 + `control_plane` config).
- `hermes memory status`-style tools construct throwaway provider
  instances — journal is multi-connection-safe (WAL) by design.
- The api_server `/api/sessions` list only shows API-created sessions —
  Telegram sessions won't appear in the ask-modal selector; the
  `eye-console` default is the reliable target.
- Frontend build: `cd build/eye_frontend && npm run build` (esbuild),
  then `./build/deploy.sh`. Typecheck with `npx tsc --noEmit` — keep it clean.
  Frontend-only changes do NOT need a gateway restart (static files are read
  per request); server-side `*.py` changes DO (the plugin loader pre-imports
  all plugin submodules).
- **Render discipline is dirty-flag now** (D-0010): if you add anything the
  canvas must react to, either emit a store topic the Field subscribes to
  (`facts`/`selection`/`entities`/`trustlens`/`halo`) or call
  `field.requestDraw()`. Never reintroduce an unconditional rAF loop.
- All CSS font sizes are rem (13px = 1rem at the html root) so the ⚙ text-size
  setting works — don't add new `font-size: Npx` rules.
- Journal is `synchronous=NORMAL` — do not "fix" that back to FULL;
  it's a measured 2.5ms→0.1ms win and the loss mode is acceptable
  (see D-0008 item 10).

## Repo layout

```
PLAN.md          ← the source (vision 🫀 + spec 🧠 + decisions), fold-back mandatory
HANDOFF.md       ← this file
README.md        ← daily use + recompile + restore
feedback/        ← Ben's feedback rounds, screenshots, root-cause tables
mockup.html      ← P0 rendered mockup (design tokens proving ground)
build/
  eye_provider/  ← wrapper+journal+control plane (Python) → ~/.hermes/plugins/holographic-eye/
  eye_frontend/  ← TS canvas GUI → served by control plane (+ Tauri)
  eye_commands/  ← /holo companion plugin
  eye_shell/     ← Tauri shell (.deb via `cargo tauri build --bundles deb`)
  eye_icons/     ← Blossom-language icon generator (make_icons.py)
  verify/        ← acceptance harnesses (run them; they're fast)
  deploy.sh      ← rsync deploy of provider+frontend+commands
```

Everything in `build/` is regenerable from PLAN.md — if the tree and the
PLAN ever disagree, the PLAN wins and the code recompiles.
