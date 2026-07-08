# HANDOFF — The Holographic Eye (as of 2026-07-08, v1.0.2)

For the next session (any agent, or Ben). Source of truth is **PLAN.md**;
this file is the "where we are + what's next" pointer. Read PLAN's
status header + PART 7 decision log (D-0001…D-0014).

## Current state (all live on Ben's machine)

| Thing | State |
|---|---|
| Release | **v1.0.2 SHIPPED 2026-07-08** — [GitHub release](https://github.com/RamenFast/holographic-eye/releases/tag/v1.0.2) (tag `v1.0.2` on master): .deb + .rpm + source tarball + SHA256SUMS. Installed locally (`holographic-eye --version` → 1.0.2); provider deployed + gateway restarted + boot-warm verified live. Release law: every commit landing on master IS a release and gets rebuilt. Branches: master + `dev` (the one local testing branch, currently = master + this doc update). |
| Wrapper provider | `memory.provider: holographic-eye`, live in the gateway; journal capturing everything (`~/.hermes/eye_journal.db`) |
| Probe latency | **FIXED** (D-0012): 4.18 s → 0.04 s warm. `accel.py` memoizes the bundled encoders at runtime (zero upstream diffs, byte-identical — harness-proven). /stats shows cache telemetry. Kill-switch: `plugins.holographic-eye.accel: false`. |
| Control plane | `http://127.0.0.1:8770`, token `~/.hermes/eye_token`. Binds only inside `hermes gateway run` (D-0012 port-theft fix). **Now boot-warms at gateway start (D-0015)** — a dedicated provider brings :8770 up ~1 s after boot, no agent message needed; triggered by the `/holo` companion (loaded at boot) force-loading the lazily-loaded exclusive provider. Manual wake (older path, still works): an api_server :8642 message. |
| GUI | v4 chrome (D-0011): 10 palette rows, Blossom Dark default, v3 look = "Blossom AMOLED" chip. Procedural garden in its own lane + behind the Field (D-0013). Break-tested: 31 Playwright checks ALL-PASS, 0 idle draws, zero console errors. |
| Icon | Drawn by the Phosphor engine (D-0014) — regenerate with `python3 build/eye_icons/make_icons.py` (needs phosphor ≥ 4.6 on PATH; silent, isolated instance). |
| CLI / chat | `hermes holographic-eye status|tail|undo-last|backup|gui` · `/holo` |
| Acceptance | `build/verify/p1_equivalence.py` + `p2_control.py` + `test_bootwarm.py` (D-0015) — ALL-PASS 2026-07-08 with accel installed. GUI: scratchpad Playwright suite (patterns worth re-creating; uses playwright-core + headless Thorium). |

## Next session candidates

1. Ben's feedback round 3 on the v1.0.0 chrome/themes/garden — log in
   `docs/dev/feedback/`, fold back as D-0015+.
2. Entity Desk curation session (the junk entities are still Ben's
   call — machinery verified).
3. Q5 quarantine / UMAP opt-in — still deliberately deferred.
4. If a release is cut: follow the release flow below, verbatim.

## Release flow (the law, mirrored from sysmon)

```
work on dev → bump versions (tauri.conf.json + Cargo.toml +
  eye_provider/__init__.py __version__ + frontend package.json) →
build frontend (npm run build) + deploy.sh + gateway restart if
  server-side changed → re-run p1+p2 → break-test →
cargo tauri build --bundles deb,rpm →
sudoplz sudo apt install -y --reinstall ./holographic-eye_X.Y.Z_amd64.deb →
merge --no-ff to master → tag vX.Y.Z → git archive source tarball →
sha256sum * > SHA256SUMS → gh release create vX.Y.Z <assets>
  --notes-file <notes.md> → fresh screenshots into docs/ →
update this HANDOFF + PLAN status header.
```

## Gotchas that will bite you (learned the hard way)

- **Port-theft**: only the gateway may own :8770. If /stats looks
  stale after a deploy, check `ss -tlnp | grep 8770` — a pre-fix
  dashboard/CLI process may still hold it; restart that service.
- Control plane now **boot-warms** (D-0015): after a gateway restart
  :8770 comes up on its own in ~1 s, no message needed. The trigger
  chain is indirect — the wrapper is an *exclusive* memory plugin
  (loaded lazily, NOT at boot), so the `/holo` companion plugin
  (`eye_commands`, loaded at boot) force-loads it in the gateway, whose
  `register()` starts a dedicated boot provider. If :8770 is dark after
  a restart: check `~/.hermes/logs/agent.log` for `eye-commands-bootwarm`
  / "boot-warmed", confirm the gateway argv has the token `gateway`, and
  that `/holo` is still deployed. Manual fallback wake: an api_server
  :8642 message. **Why it existed:** Hermes moved TUI turns into
  `tui_gateway.slash_worker` subprocesses where the old lazy
  per-session start never fired in the gateway.
- Server-side `*.py` changes need a gateway restart (loader pre-imports
  all plugin submodules); frontend-only changes do NOT.
- Frontend build: `cd build/eye_frontend && npm run build`, then
  `./build/deploy.sh`. Typecheck with `npx tsc --noEmit` — keep clean.
- Render discipline is dirty-flag: new canvas-reactive state must emit
  a store topic the Field subscribes to (now incl. `theme`) or call
  `field.requestDraw()`. Never reintroduce an unconditional rAF loop.
- All CSS font sizes are rem (13px = 1rem); no new `font-size: Npx`.
- **Themes are token rows**: new UI reads CSS custom properties (and
  canvas code reads the `theme` bridge in state.ts). Never hardcode a
  color — that's the D-0011 law. New theme = one CSS block + one
  THEMES row (+ preview swatch) in state.ts.
- Garden: decoration must stay in the lane or behind the data canvas
  (D-0013). Flowers over UI = regression.
- Journal is `synchronous=NORMAL` — do not "fix" back to FULL (D-0008
  #10). `retrieval_counts()` is incremental — it relies on the journal
  being append-only with immutable responses; never UPDATE a response.
- The icon generator drives a private phosphor via WAVs; keep figures
  CLOSED and one figure per snapshot (a scope has no pen-up).
- Discovery calls `register()` on every scan → constructor stays cheap.

## Repo layout

```
PLAN.md          ← the source (vision 🫀 + spec 🧠 + decisions D-0001…D-0014)
HANDOFF.md       ← this file
README.md        ← concise, humans + agents; honest ledger
docs/            ← release screenshots · docs/dev/ (mockup, feedback rounds, release notes)
build/
  eye_provider/  ← wrapper+journal+control plane+accel (Python) → ~/.hermes/plugins/holographic-eye/
  eye_frontend/  ← TS canvas GUI (palette rows, garden) → served by control plane (+ Tauri)
  eye_commands/  ← /holo companion plugin
  eye_shell/     ← Tauri shell → .deb + .rpm (cargo tauri build --bundles deb,rpm)
  eye_icons/     ← make_icons.py — the Phosphor-drawn icon pipeline
  verify/        ← acceptance harnesses (fast; run with the hermes venv python)
```

Everything in `build/` is regenerable from PLAN.md — if the tree and
the PLAN ever disagree, the PLAN wins and the code recompiles.
