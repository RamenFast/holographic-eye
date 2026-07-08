# The Holographic Eye v1.0.3 — legible dropdowns

A one-line-of-CSS legibility fix, from Ben's hands-on pass.

## Fixed

- **The settings text-size box was hard to read.** The native `<select>`
  dropdowns (⚙ → text size, and the ask-the-agent target picker) rendered
  with the WebKitGTK GTK widget skin — a light box with faint grey text
  that ignored the themed `--ink-surface` / `--ink-text`, so the current
  value was barely legible in the dark rooms. Now the native appearance is
  dropped so the theme tokens apply (crisp `--ink-text` on the room's
  surface), with a themed caret and a themed option popup. Every one of the
  10 rooms styles the dropdowns like the rest of the panel.

## Removed, honestly

Nothing — one CSS fix, frontend-only. The desktop shell (`.deb`/`.rpm`) is
a pane of glass onto the control plane and is byte-identical in behavior to
v1.0.2; it's rebuilt only to keep the version aligned. If you already run
v1.0.2, the fix is in the provider's served frontend — `git pull &&
./build/deploy.sh` and reload the window; no gateway restart needed.

## Install

```bash
sudo apt install ./holographic-eye_1.0.3_amd64.deb      # deb systems
sudo dnf install ./holographic-eye-1.0.3-1.x86_64.rpm   # rpm systems
holographic-eye --version                                # → holographic-eye 1.0.3
```

`SHA256SUMS` covers every asset.

## Receipts

- Fix verified in the actual Tauri/WebKitGTK app (off-screen): the text-size
  box shows crisp themed text + a caret; the open dropdown lists all four
  sizes legibly; both `<select>`s (text size + ask target) covered.
- `p1` (15/15) + `p2` (25/25) + `test_bootwarm.py` (14/14) ALL-PASS.
- Gateway restart → `:8770` boot-warms at 1.0.3 in ~1 s (D-0015 holds).
  `--version` and `/health` both answer 1.0.3.

---

⊙ *Compiled from PLAN.md by Claude (Opus 4.8) with Ben — the rooms read
clearly now.*
