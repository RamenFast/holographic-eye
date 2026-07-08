# The Holographic Eye v1.0.0 — first packaged release

Glass cockpit for the Hermes `holographic` memory provider: the
agent's memory drawn as its **real HRR geometry**, every write
journaled with before/after images, everything undoable, and the
agent itself on the other end of an ask. Zero Hermes core changes.

![the Field, Blossom Dark](https://github.com/RamenFast/holographic-eye/raw/v1.0.0/docs/hero-blossom-dark.png)

## Since the last deployed build (2026-07-03)

| | before | v1.0.0 |
|---|---|---|
| entity probe / Reason Workbench | ~4.2 s per click (measured) | **~40 ms** — runtime encoder memoization in the wrapper; zero upstream diffs, byte-identical results (equivalence harness re-proven) |
| chrome | one hardcoded true-black look | **10 palette rows** in the sysmon/Phosphor token system — Blossom Dark default; the old look preserved verbatim as *Blossom AMOLED* |
| pixel garden | tiled → visibly symmetrical; overlaid the stream and pane scrollbars | seeded-RNG planting in a **layout-reserved lane** + vines/cottage *behind* the Field canvas — coverage is impossible by construction |
| app icon | static SVG rings | **drawn by the Phosphor engine**: closed parametric curves synthesized as stereo WAVs, traced by the CRT beam in XY mode, snapshotted per color layer |
| find (F) | the opening keystroke leaked into the input — every search silently became `F…` (shipped since v3) | fixed, plus the click-away dismiss no longer disarms itself |
| Inspect click cost | full-journal scan per click for recall counts | incremental (append-only journal ⇒ exact) |
| port hygiene | any long-lived hermes process could steal :8770 and serve stale code across upgrades (it happened — a dashboard held it) | control plane binds only inside `hermes gateway run`; failed binds retry |
| packaging | hand-built `.deb` only | `.deb` + `.rpm` + source tarball + `SHA256SUMS`, rebuilt every release |

## Removed, honestly

- The **"no dark/light toggle" anti-goal** — retired by Ben's
  direction (PLAN D-0011). Ten themes now, all equal-care.
- The **repeat-x flowerbed tile and edge-vine overlays** — replaced
  wholesale (D-0013); the stream's padding-bottom hack died with them.
- Nothing else was removed. Quarantine mode (Q5) and the UMAP
  projector remain deliberately unbuilt — see the README ledger.

## Install

The Eye watches a living gateway: Hermes installed, the wrapper
provider deployed + selected, gateway booted (see README §Install).

```bash
# Debian / Ubuntu / Mint — or double-click the .deb
sudo apt install ./holographic-eye_1.0.0_amd64.deb

# Fedora / RHEL
sudo dnf install ./holographic-eye-1.0.0-1.x86_64.rpm

# from source
tar xf holographic-eye-1.0.0.tar.gz && cd holographic-eye-1.0.0
cd build/eye_frontend && npm install && npm run build && cd ../..
./build/deploy.sh
cd build/eye_shell/src-tauri && cargo tauri build --bundles deb,rpm

# verify
holographic-eye --version              # → holographic-eye 1.0.0
curl -s http://127.0.0.1:8770/health   # → {"ok": true, …, "version": "1.0.0"}
```

Built on Linux Mint 22; `.deb` installed and relaunch-verified there.
`.rpm` requires exactly `libwebkit2gtk-4.1` + `libgtk-3` (structure
`rpm --test` verified on the build box) — Fedora reports welcome.

`SHA256SUMS` covers every asset: `sha256sum -c SHA256SUMS`.

## Receipts

- 40/40 offline acceptance checks (p1 equivalence, p2 control plane)
  with the accelerator installed — agent-visible behavior stays
  bit-identical to stock.
- 31/31 Playwright GUI checks: 10-theme sweep, garden-lane geometry,
  dirty-flag 0 idle draws, entity storm, typed-ID delete guard,
  Workbench 143 ms through the full UI, zero console errors.
- Live: `probe(hermes)` 4.18 s → 0.09 s cold / 0.04 s warm on 541 facts.

---

⊙ *Compiled from PLAN.md by Claude (Fable 5) with Ben — the beams in
the icon were traced by [Phosphor], Ben's CRT oscilloscope, because
the eye deserved to be drawn by an instrument, not a paintbrush.*
