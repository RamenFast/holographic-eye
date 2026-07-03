# HANDOFF — The Holographic Eye (as of 2026-07-02, end of build session 1)

For the next session (any agent, or Ben). Source of truth is **PLAN.md**;
this file is the "where we are + what's next" pointer. Read PLAN's
"Status: BUILT & LIVE" header + PART 7 decision log (D-0001…D-0008), then
`feedback/2026-07-02-round2.md` — that's the work queue.

## Current state (all live on Ben's machine)

| Thing | State |
|---|---|
| Wrapper provider | `memory.provider: holographic-eye`, live in the gateway since 2026-07-02 evening; journal capturing everything (`~/.hermes/eye_journal.db`) |
| Control plane | `http://127.0.0.1:8770`, token `~/.hermes/eye_token`, serves the GUI |
| GUI | v2 (post feedback-round-1) deployed; Tauri `.deb` installed (`/usr/bin/holographic-eye`, in the menu) |
| CLI / chat | `hermes holographic-eye status\|tail\|undo-last\|backup\|gui` · `/holo` on Telegram/CLI |
| Backups | D-0007; first backup on Mass storage; restore is cold-only (README) |
| api_server | enabled via `API_SERVER_KEY` in `~/.hermes/.env` (loopback :8642); asks land in the `eye-console` session |
| Acceptance | `build/verify/p1_equivalence.py` (15 checks) + `p2_control.py` (25 checks) — both ALL-PASS as of the last change |

## Next session, in order

1. **Feedback round 2** — `feedback/2026-07-02-round2.md`. Start with the
   three priority polish areas (P-1 render discipline/idle CPU, P-2
   affordance truthfulness, P-3 one manual + honest settings); the table
   has a root-cause + fix sketch for every item. Delight items (flower
   variety + toggle, pixel cottage bottom-right, font-size setting) after.
2. Re-run both verify harnesses after any server change; redeploy via
   `./build/deploy.sh`; **gateway restart required for server-side code**
   (the plugin loader pre-imports all plugin `*.py`), NOT for frontend.
3. Fold everything back into PLAN.md (D-0009 …) — the discipline held so
   far; keep it.

## Gotchas that will bite you (learned the hard way)

- Discovery calls the provider's `register()` on every scan → constructor
  must stay cheap/side-effect-free.
- CLI processes skip the control plane on purpose (port-theft; see PLAN
  Addendum 2 + `control_plane` config).
- `hermes memory status`-style tools construct throwaway provider
  instances — journal is multi-connection-safe (WAL) by design.
- The api_server `/api/sessions` list only shows API-created sessions —
  Telegram sessions won't appear in the ask-modal selector; the
  `eye-console` default is the reliable target.
- Frontend build: `cd build/eye_frontend && npm run build` (esbuild),
  then deploy. Typecheck with `npx tsc --noEmit` — keep it clean.
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
