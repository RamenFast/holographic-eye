#!/usr/bin/env python3
"""make_icons.py — The Holographic Eye icon, drawn by the Phosphor engine.

v2 (2026-07-07, Ben's direction): "blossom design (flowers around eye,
not blocking) with an eye in the center. Blue. Flowers pink/yellow.
Made using the phosphor engine to draw the images."

So that is literally what happens here: every figure is synthesized as
a stereo WAV whose L/R channels parametrically trace the shape, a
private background Phosphor instance (Ben's CRT oscilloscope) plays it
in XY mode at volume 0, and the persistent beam is snapshotted per
color layer:

  layer 1  Ice Blue    — almond eye outline
  layer 2  Ice Blue    — iris ring + pupil ring (concentric echo of
                         the v1 hologram glyph)
  layer 3  Vaporwave   — six five-petal rose curves (r = cos 5θ)
                         ringed around the eye, jittered, never over it
  layer 4  Solar Gold  — four small four-petal roses + gold hearts at
                         the pink flowers' centers

The layers screen-blend onto a near-black body. All figures are CLOSED
curves (phosphor-icon law #1); "pen-up" between subpaths is a single-
sample jump whose transit deposits almost no energy, and any residue is
floored away in compositing.

Outputs:
  out/eye-master.png + eye-{32,64,128,256,512}.png   (app icon)
  out/glyph-{probed,idle,empty}.svg                  (entity monograms)
  ../eye_frontend/favicon.png                        (64px favicon)
  ../eye_shell/src-tauri/icons/                      (Tauri bundle set)

Requires: phosphor ≥ 4.6 on PATH, numpy, PIL. Isolated instance —
never touches a running scope's socket (own XDG_RUNTIME_DIR).
"""

from __future__ import annotations

import json
import math
import os
import random
import shutil
import subprocess
import tempfile
import time
import wave
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
TAURI_ICONS = HERE.parent / "eye_shell" / "src-tauri" / "icons"
FAVICON = HERE.parent / "eye_frontend" / "favicon.png"

SR = 48000
CYCLE_HZ = 22          # figure repetitions per second
LAYER_SECONDS = 6.0
SETTLE_SECONDS = 2.6   # persistence build-up before the snapshot
SEED = 0x0EE1          # tuned by eye — same seed, same garden
BODY = (11, 14, 18)    # near-black chassis
EDGE = (42, 46, 55)

PINK = "Vaporwave"
GOLD = "Solar Gold"
BLUE = "Ice Blue"


# ── the geometry (all closed curves, icon space [-1, 1], y up) ──────

def almond(n: int) -> np.ndarray:
    """Eye outline: arched upper lid, shallower lower lid, sharp
    corners at x = ±w. One continuous closed loop."""
    w, h_up, h_lo, cy = 0.56, 0.33, 0.24, -0.02
    t = np.linspace(0.0, 2.0 * np.pi, n, endpoint=False)
    x = w * np.cos(t)
    y = np.where(np.sin(t) >= 0,
                 h_up * np.sin(t) ** 1.0,
                 h_lo * np.sin(t))
    return np.stack([x, y + cy], axis=1)


def circle(cx: float, cy: float, r: float, n: int) -> np.ndarray:
    t = np.linspace(0.0, 2.0 * np.pi, n, endpoint=False)
    return np.stack([cx + r * np.cos(t), cy + r * np.sin(t)], axis=1)


def rose(cx: float, cy: float, radius: float, k: int, phase: float,
         n: int) -> np.ndarray:
    """r = cos(kθ) rose with a petal-fattening exponent (a straight
    cosine rose reads spidery on the scope). Odd k closes over π
    (k petals); even k over 2π (2k petals). Both are closed loops."""
    span = np.pi if k % 2 else 2.0 * np.pi
    t = np.linspace(0.0, span, n, endpoint=False)
    c = np.cos(k * t)
    r = radius * np.sign(c) * np.abs(c) ** 0.62
    return np.stack([cx + r * np.cos(t + phase),
                     cy + r * np.sin(t + phase)], axis=1)


def flower_ring(rng: random.Random):
    """Jittered ring of blossoms around the eye — placed to frame it,
    never to cover it (the eye spans ±0.56 × +0.31/−0.26)."""
    pinks, golds = [], []
    for base in (18, 72, 148, 205, 258, 322):          # pink, 5-petal
        ang = math.radians(base + rng.uniform(-9, 9))
        rad = rng.uniform(0.74, 0.84)
        size = rng.uniform(0.14, 0.19)
        pinks.append((rad * math.cos(ang), rad * math.sin(ang) * 0.92,
                      size, rng.uniform(0, math.pi)))
    for base in (45, 118, 238, 295):                   # gold, 4-petal
        ang = math.radians(base + rng.uniform(-10, 10))
        rad = rng.uniform(0.72, 0.80)
        size = rng.uniform(0.075, 0.10)
        golds.append((rad * math.cos(ang), rad * math.sin(ang) * 0.92,
                      size, rng.uniform(0, math.pi)))
    return pinks, golds


# ── WAV synthesis ───────────────────────────────────────────────────

def path_to_wav(cycle: np.ndarray, dest: Path) -> None:
    """One CLOSED figure per WAV — a scope has no pen-up, and the
    v2 draft proved a between-figure jump draws a bright chord (the
    'hidden hexagon'). One figure per snapshot means the beam's whole
    dwell budget lands on that figure: brighter, smoother."""
    reps = max(1, int(LAYER_SECONDS * CYCLE_HZ))
    sig = np.tile(cycle, (reps, 1))
    want = int(SR * LAYER_SECONDS)
    idx = np.linspace(0, len(sig) - 1, want).astype(int)
    pcm = np.clip(sig[idx], -1.0, 1.0)
    with wave.open(str(dest), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((pcm * 32767).astype("<i2").tobytes())


# ── the phosphor session ────────────────────────────────────────────

class Scope:
    """Private background Phosphor: own config + runtime dir (short
    path — ctl socket must fit SUN_LEN), pipewire passed through,
    volume 0 (the beam taps pre-volume; Ben hears nothing)."""

    def __init__(self, workdir: Path):
        self.env = dict(os.environ)
        cfg = workdir / "cfg"
        (cfg / "phosphor").mkdir(parents=True, exist_ok=True)
        (workdir / "rt").mkdir(exist_ok=True)
        self.env.update({
            "XDG_CONFIG_HOME": str(cfg),
            "XDG_RUNTIME_DIR": str(workdir / "rt"),
            "PIPEWIRE_RUNTIME_DIR": "/run/user/1000",
            "PULSE_SERVER": "unix:/run/user/1000/pulse/native",
            "PHOSPHOR_NO_SINGLE_INSTANCE": "1",
        })
        settings = {
            "display_mode": "xy", "gain": 1.36, "auto_gain": False,
            "persistence": 0.93, "beam_energy": 70.0, "beam_focus": 0.35,
            "theme_name": BLUE, "grid_enabled": False,
            "amoled_background": True, "scope_glass": False,
            "window_width": 900, "window_height": 900,
            "start_in_mini": False, "show_fps": False,
            "show_pin_button": False, "epilepsy_acknowledged": True,
            "kit_enabled": False, "renderer": "gl",
        }
        # seed on top of the user's file so unrelated keys stay valid
        base = {}
        user_settings = Path.home() / ".config/phosphor/settings.json"
        if user_settings.exists():
            base = json.loads(user_settings.read_text())
        base.update(settings)
        (cfg / "phosphor" / "settings.json").write_text(json.dumps(base))
        self.proc = subprocess.Popen(
            ["phosphor", "--background"], env=self.env,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self._wait_ready()
        self.ctl("volume", "0")

    def _wait_ready(self) -> None:
        for _ in range(40):
            time.sleep(0.5)
            try:
                out = subprocess.run(
                    ["phosphor", "probe", "--json"], env=self.env,
                    capture_output=True, text=True, timeout=10)
                if json.loads(out.stdout).get("running"):
                    return
            except Exception:
                pass
        raise RuntimeError("phosphor --background never came up")

    def ctl(self, *args: str) -> dict:
        out = subprocess.run(
            ["phosphor", "ctl", *args, "--json"], env=self.env,
            capture_output=True, text=True, timeout=30)
        reply = json.loads(out.stdout)
        if reply.get("status") != "ok":
            raise RuntimeError(f"ctl {args}: {reply.get('error')}")
        return reply

    def draw_layer(self, wav: Path, theme: str) -> Path:
        self.ctl("theme", theme)
        self.ctl("open", str(wav))
        self.ctl("volume", "0")
        time.sleep(SETTLE_SECONDS)
        path = Path(self.ctl("snapshot")["result"]["path"])
        for _ in range(20):
            if path.exists() and path.stat().st_size > 0:
                break
            time.sleep(0.25)
        return path

    def close(self) -> None:
        try:
            self.ctl("quit")
        except Exception:
            self.proc.terminate()


# ── compositing ─────────────────────────────────────────────────────

def load_layer(path: Path, floor: int = 14) -> np.ndarray:
    """Beam snapshot → float RGB with the sub-floor glow (and any
    single-sample transit residue) removed."""
    im = np.asarray(Image.open(path).convert("RGB"), dtype=np.float32)
    scale = np.clip((im.max(axis=2, keepdims=True) - floor)
                    / max(1.0, 255.0 - floor), 0.0, 1.0)
    lit = im * (scale > 0)
    return np.clip(lit / 255.0, 0.0, 1.0)


def screen(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return 1.0 - (1.0 - a) * (1.0 - b)


def compose(layers: list[np.ndarray]) -> Image.Image:
    # stack the beams on black first (transparency-first law: judge
    # the geometry with nothing to hide behind), then crop to the
    # figure with an 8% margin so the icon fills its plate
    beams = layers[0]
    for layer in layers[1:]:
        beams = screen(beams, layer)
    luma = beams.max(axis=2)
    ys, xs = np.where(luma > 0.03)
    if len(xs):
        cx, cy = (xs.min() + xs.max()) // 2, (ys.min() + ys.max()) // 2
        half = int(max(xs.max() - xs.min(), ys.max() - ys.min()) * 0.54)
        half = min(half, cx, cy, beams.shape[1] - cx, beams.shape[0] - cy)
        beams = beams[cy - half:cy + half, cx - half:cx + half]
    body = np.full_like(beams, 0.0)
    body[:] = np.array(BODY, dtype=np.float32) / 255.0
    out = screen(body, beams)
    img = Image.fromarray((out * 255).astype(np.uint8), "RGB")
    return img.convert("RGBA")


def frame_and_export(master: Image.Image) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    TAURI_ICONS.mkdir(parents=True, exist_ok=True)
    master.save(OUT / "eye-master.png")
    # thin beams lose energy when shrunk — small sizes get a screen-
    # doubled master so the figure survives at dock/tab scale
    arr = np.asarray(master.convert("RGB"), dtype=np.float32) / 255.0
    boosted = Image.fromarray(
        ((1.0 - (1.0 - arr) ** 2) * 255).astype(np.uint8), "RGB"
    ).convert("RGBA")
    for size in (512, 256, 128, 64, 32):
        src = boosted if size <= 64 else master
        im = src.resize((size, size), Image.LANCZOS)
        # sharp-cornered hairline frame, scaled to the size
        px = im.load()
        t = max(1, size // 128)
        for i in range(size):
            for j in list(range(t)) + list(range(size - t, size)):
                px[i, j] = (*EDGE, 255)
                px[j, i] = (*EDGE, 255)
        im.save(OUT / f"eye-{size}.png")
    mapping = {"32x32.png": 32, "128x128.png": 128,
               "128x128@2x.png": 256, "icon.png": 512}
    for name, size in mapping.items():
        shutil.copyfile(OUT / f"eye-{size}.png", TAURI_ICONS / name)
    shutil.copyfile(OUT / "eye-64.png", FAVICON)


# ── entity-state monograms (unchanged v1 language) ──────────────────

MONO_PINK = "#db3776"
MONO_GOLD = "#f1bf40"
MONO_LB = "#a9d3e8"


def monogram(kind: str) -> str:
    color = {"probed": MONO_PINK, "idle": MONO_LB, "empty": MONO_GOLD}[kind]
    inner = {
        "probed": f'<circle cx="24" cy="24" r="5" fill="{color}"/>',
        "idle": "",
        "empty": (f'<line x1="17" y1="17" x2="31" y2="31" stroke="{color}" stroke-width="2.4"/>'
                  f'<line x1="31" y1="17" x2="17" y2="31" stroke="{color}" stroke-width="2.4"/>'),
    }[kind]
    op = "0.65" if kind == "idle" else "1"
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">'
            f'<circle cx="24" cy="24" r="13" fill="none" stroke="{color}" '
            f'stroke-width="2.4" opacity="{op}"/>{inner}</svg>')


# ── main ────────────────────────────────────────────────────────────

def main() -> None:
    rng = random.Random(SEED)
    pinks, golds = flower_ring(rng)

    # one closed figure per layer, grouped by beam theme so the scope
    # switches phosphor three times, not thirteen
    figures: list[tuple[str, str, np.ndarray]] = (
        [("eye", BLUE, almond(2400)),
         ("iris", BLUE, circle(0.0, -0.02, 0.215, 1600)),
         ("pupil", BLUE, circle(0.0, -0.02, 0.085, 1000))]
        + [(f"pink{i}", PINK, rose(cx, cy, s, 5, ph, 2000))
           for i, (cx, cy, s, ph) in enumerate(pinks)]
        + [(f"gold{i}", GOLD, rose(cx, cy, s, 2, ph, 1600))
           for i, (cx, cy, s, ph) in enumerate(golds)]
    )

    with tempfile.TemporaryDirectory(prefix="eyeic-", dir="/tmp") as td:
        work = Path(td)
        scope = Scope(work)
        snaps: list[Path] = []
        try:
            for name, theme, cycle in figures:
                wav = work / f"{name}.wav"
                path_to_wav(cycle, wav)
                snaps.append(scope.draw_layer(wav, theme))
        finally:
            scope.close()

        layers = [load_layer(p) for p in snaps]
        master = compose(layers)
        # keep Ben's Pictures folder clean — the snapshots were ours
        for p in snaps:
            try:
                p.unlink()
            except OSError:
                pass

    frame_and_export(master)
    for kind in ("probed", "idle", "empty"):
        (OUT / f"glyph-{kind}.svg").write_text(monogram(kind))
    print(f"icons → {OUT}, {TAURI_ICONS}, {FAVICON}")


if __name__ == "__main__":
    main()
