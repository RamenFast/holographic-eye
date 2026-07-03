#!/usr/bin/env python3
"""make_icons.py — The Holographic Eye icon set, in the Blossom icon language.

Language (from blossom/tools/blossom_icons.py): dark body just visible on
true black, light-blue line glyphs, pink accent for the acted-on element,
gold for anchors/references, squared-off corners.

App icon: the concentric-ring hologram glyph — an interference-pattern echo.
Light-blue rings (the algebra), one pink arc (the acting eye), gold core
(the reference point everything is measured against).

Outputs:
  out/eye.svg + eye-{32,64,128,256,512}.png     (app icon)
  out/glyph-{probed,idle,empty}.svg             (entity-state monograms)
  ../eye_shell/src-tauri/icons/                 (Tauri bundle set)

Requires rsvg-convert (librsvg2-bin).
"""

from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
OUT = HERE / "out"
TAURI_ICONS = HERE.parent / "eye_shell" / "src-tauri" / "icons"

PINK = "#db3776"
GOLD = "#f1bf40"
LB = "#a9d3e8"      # light-blue lines, slightly deeper than text-blue for contrast
BODY = "#101216"
EDGE = "#2a2e37"


def app_icon() -> str:
    # 128 viewBox; squared-corner body per Ben's square > round preference
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <defs>
    <radialGradient id="depth" cx="0.5" cy="0.42" r="0.75">
      <stop offset="0" stop-color="#181b21"/>
      <stop offset="1" stop-color="{BODY}"/>
    </radialGradient>
  </defs>
  <rect x="6" y="6" width="116" height="116" rx="14" fill="url(#depth)"/>
  <rect x="6" y="6" width="116" height="116" rx="14" fill="none" stroke="{EDGE}" stroke-width="1.5"/>
  <rect x="7.5" y="7.5" width="113" height="10" rx="8" fill="#ffffff" opacity="0.05"/>

  <!-- interference rings: the algebra -->
  <circle cx="64" cy="64" r="40" fill="none" stroke="{LB}" stroke-width="2.6" opacity="0.9"/>
  <circle cx="64" cy="64" r="28" fill="none" stroke="{LB}" stroke-width="2.0" opacity="0.62"/>
  <circle cx="64" cy="64" r="17" fill="none" stroke="{LB}" stroke-width="1.6" opacity="0.4"/>

  <!-- the acting arc: pink, sweeping the outer ring -->
  <path d="M 64 24 A 40 40 0 0 1 100.5 48.5" fill="none" stroke="{PINK}"
        stroke-width="5" stroke-linecap="round"/>

  <!-- interference nodes where rings would beat -->
  <circle cx="36.7" cy="49.2" r="2.2" fill="{LB}" opacity="0.85"/>
  <circle cx="88.5" cy="83.5" r="2.2" fill="{LB}" opacity="0.85"/>

  <!-- gold core: the reference -->
  <circle cx="64" cy="64" r="6.5" fill="{GOLD}"/>
  <circle cx="64" cy="64" r="6.5" fill="none" stroke="#000000" stroke-width="1" opacity="0.35"/>
</svg>'''


def monogram(kind: str) -> str:
    color = {"probed": PINK, "idle": LB, "empty": GOLD}[kind]
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


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    TAURI_ICONS.mkdir(parents=True, exist_ok=True)

    svg = OUT / "eye.svg"
    svg.write_text(app_icon())
    for kind in ("probed", "idle", "empty"):
        (OUT / f"glyph-{kind}.svg").write_text(monogram(kind))

    sizes = [32, 64, 128, 256, 512]
    for s in sizes:
        subprocess.run(["rsvg-convert", "-w", str(s), "-h", str(s),
                        str(svg), "-o", str(OUT / f"eye-{s}.png")], check=True)

    # Tauri bundle set (Linux .deb uses the PNGs; icon.png is the main one)
    mapping = {
        "32x32.png": 32, "128x128.png": 128, "128x128@2x.png": 256,
        "icon.png": 512,
    }
    for name, s in mapping.items():
        (TAURI_ICONS / name).write_bytes((OUT / f"eye-{s}.png").read_bytes())
    print(f"icons → {OUT} and {TAURI_ICONS}")


if __name__ == "__main__":
    main()
