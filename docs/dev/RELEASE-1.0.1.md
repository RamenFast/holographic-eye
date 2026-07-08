# The Holographic Eye v1.0.1 — feedback round 3

Same-day polish on v1.0.0, from Ben's hands-on pass.

## Fixed

- **Garden glitched on theme switch.** Root cause: the bed canvas was
  sized from `getBoundingClientRect()`, which returns the
  *transform-scaled* box — a theme switch landing mid-bloom (the
  sprout animation scales from 0) resized the canvas to **1 px tall**
  and it stayed smeared. Now measured with layout boxes
  (`offsetWidth/Height`, transform-immune), theme switches repaint
  without re-blooming, and the double-draw path (settings chip +
  store listener both regrowing) is gone. Receipt: a 6-theme storm at
  60 ms intervals keeps the bed at 720×11 with all 696 flower pixels,
  every time (it collapsed to 720×1 before). The lane's ground color
  reads the theme's base token — cream under Paper, wine under
  Blossom Dark.
- **The eye gazed downward.** The almond's lids are asymmetric, so
  its *visual* aperture center sits above the geometric center — and
  iris + pupil were parked at the geometric one. They now sit at the
  aperture center: the eye looks at you.

## Improved

- **A more potent eye** (Ben: "stitch multiple waveforms…"): the eye
  figures are double-exposed (each beam snapshot screen-blended
  twice), and two new scope-drawn figures joined — a spectral
  **Cyan Tube inner iris ring** and a hot **White pupil core**, the
  catch-light. The eye now out-glows its garden at every size.
- **New README section:** *Multiple sessions & windows — is the
  database safe?* One provider instance inside the gateway serves
  every session at once; any number of Eye windows can watch;
  mutations serialize through the provider's store API and are
  journaled/undoable; both DBs are WAL. The only forbidden move
  remains hot-restoring a backup (restore stays cold).

## Removed, honestly

Nothing. This is fixes + additions only.

## Install

```bash
sudo apt install ./holographic-eye_1.0.1_amd64.deb      # deb systems
sudo dnf install ./holographic-eye-1.0.1-1.x86_64.rpm   # rpm systems
holographic-eye --version                                # → holographic-eye 1.0.1
```

Provider update (if coming from 1.0.0): `git pull && ./build/deploy.sh
&& hermes gateway restart`. `SHA256SUMS` covers every asset.

## Receipts

- 34/34 GUI break-test checks (now including the theme-storm garden
  gate) · p1 + p2 acceptance harnesses ALL-PASS · installed locally,
  `--version` answers 1.0.1, control plane `/health` answers 1.0.1.

---

⊙ *Compiled from PLAN.md by Claude (Fable 5) with Ben — the eye now
looks back.*
