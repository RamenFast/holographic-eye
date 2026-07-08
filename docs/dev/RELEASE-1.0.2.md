# The Holographic Eye v1.0.2 — the plane wakes with the gateway

A reliability fix: the desktop app connects after every gateway restart,
instead of showing its connect error until an agent message happened to
arrive.

## Fixed

- **The control plane went dormant after every gateway restart.** `:8770`
  was down — yet memory worked and the journal was live; nothing errored.
  Root cause: Hermes moved TUI/slash agent turns into
  `tui_gateway.slash_worker` subprocesses. The plane starts lazily and
  only inside the process whose argv carries the exact token `gateway`
  (the always-on `hermes gateway run`), so the workers' `initialize()`
  hit the `skip_cp` branch and never bound the port. And the wrapper is an
  *exclusive* memory plugin, loaded lazily — nothing in it runs at gateway
  boot either. Net: under a TUI-only workflow, `:8770` could stay dark
  forever. (This is **not** the v1.0.0/D-0012 port-theft `[Errno 98]`,
  which is a bind collision — this was pure dormancy, no error at all.)

## How it's fixed (D-0015 — still zero Hermes core changes)

- **The plane boot-warms at gateway start.** A dedicated provider is warmed
  on a daemon thread when the gateway boots, binding `:8770` ~1 s in — no
  agent message needed. The bind retries briefly so a socket lingering from
  the outgoing gateway across a restart self-heals.
- **The plane keeps that provider as a persistent fallback.** Reads resolve
  to the live per-session provider when one is attached, else the boot
  provider (`attach_boot` + `active_provider()`), so a session attaching
  then ending can never leave `:8770` dark. Both read the same WAL DBs, so
  a fallback read is byte-identical to a live-session read.
- **Triggered by the `/holo` companion**, which *is* loaded at boot: in the
  gateway only, it force-loads the exclusive provider so its `register()`
  runs the boot-warm.

## Removed, honestly

Nothing. One bug fixed; no features removed. The old manual wake (an
api_server `:8642` message) still works as a fallback. Kill-switches
unchanged (`accel: false`, `control_plane: never`).

## Install

```bash
sudo apt install ./holographic-eye_1.0.2_amd64.deb      # deb systems
sudo dnf install ./holographic-eye-1.0.2-1.x86_64.rpm   # rpm systems
holographic-eye --version                                # → holographic-eye 1.0.2
```

Provider update (this fix is server-side): `git pull && ./build/deploy.sh
&& hermes gateway restart`. After the restart, `:8770` comes up on its own.
`SHA256SUMS` covers every asset.

## Receipts

- New regression harness `build/verify/test_bootwarm.py` (14/14): boot
  provider serves the store as fallback with no session; a live session
  attaches over it then detaches → the plane falls back, `/health` stays
  `attached`, `/stats` keeps serving.
- `p1` (15/15) + `p2` (25/25) acceptance harnesses ALL-PASS with the
  `active_provider()` refactor.
- Live: gateway restart → `:8770` self-starts in ~1 s with no message sent;
  the journal shows `initialize · gateway-boot`; the installed app connects.
  `--version` and `/health` both answer 1.0.2. GUI bundle unchanged from
  v1.0.1 (server-side fix only).

---

⊙ *Compiled from PLAN.md by Claude (Opus 4.8) with Ben — the plane wakes
when the gateway does.*
