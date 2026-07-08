/* The pixel garden, rebuilt procedurally (D-0013).
   Three rules, in order:
   1. never cover UI — the flowerbed lives in its own layout-reserved
      lane (grid row), vines + cottage sit BEHIND the field canvas;
      data always draws over decoration.
   2. grown, not tiled — a seeded RNG places species with jittered
      spacing, height, lean and flip, so no two windows bloom alike
      (the old repeat-x tile read as a symmetrical hedge).
   3. wears the room — petal/leaf colors derive from the active
      palette tokens, so the garden re-blooms with the theme.
   GPLv3 — see LICENSE. */

import { store, theme } from "./state";

const PX = 2; // one garden pixel = 2 css px

// mulberry32 — tiny seeded PRNG; one seed per page load so a resize
// re-grows the same garden, while every launch is a new planting
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(hexA: string, hexB: string, t: number): string {
  const a = hexToRgb(hexA), b = hexToRgb(hexB);
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

interface Palette {
  stem: string; leaf: string; grass: string;
  pink: string; pinkLight: string; gold: string;
  blue: string; blueLight: string; white: string;
  soil: string;
}

function gardenPalette(): Palette {
  const dark = theme.dark;
  return {
    stem: mix(theme.add, dark ? "#000000" : "#223311", 0.35),
    leaf: theme.add,
    grass: mix(theme.add, dark ? "#000000" : "#223311", 0.18),
    pink: theme.acting,
    pinkLight: dark ? mix(theme.acting, "#ffffff", 0.35)
                    : mix(theme.acting, "#000000", 0.18),
    gold: theme.numerics,
    blue: dark ? "#6e8fd6" : "#4a6cc0",
    blueLight: dark ? "#9ab4ea" : "#7a94d8",
    white: dark ? "#e8eef2" : theme.textDim,
    soil: mix(theme.surface, dark ? "#ffffff" : "#000000", 0.10),
  };
}

type Put = (x: number, y: number, color: string) => void;

/* Each species draws relative to (x, ground) where ground is the soil
   row; heights/petals get per-plant jitter from the rng. */
function flower(put: Put, rng: () => number, p: Palette,
                x: number, ground: number): void {
  const species = rng();
  const h = 4 + Math.floor(rng() * 5);           // stem height 4–8 px
  const lean = rng() < 0.3 ? (rng() < 0.5 ? -1 : 1) : 0;
  const top = ground - h;
  for (let i = 1; i <= h; i++) {
    put(x + (i > h / 2 ? lean : 0), ground - i, p.stem);
  }
  if (rng() < 0.7) put(x + 1, ground - 1 - Math.floor(rng() * 2), p.leaf);
  if (rng() < 0.5) put(x - 1, ground - 2 - Math.floor(rng() * 2), p.leaf);
  const cx = x + lean, cy = top - 1;

  if (species < 0.26) {
    // five-petal pink
    put(cx, cy - 1, p.pinkLight); put(cx, cy + 1, p.pinkLight);
    put(cx - 1, cy, p.pink); put(cx + 1, cy, p.pink);
    put(cx - 1, cy - 1, p.pink); put(cx + 1, cy - 1, p.pinkLight);
    put(cx, cy, p.gold);
  } else if (species < 0.45) {
    // gold daisy
    put(cx, cy - 1, p.gold); put(cx, cy + 1, p.gold);
    put(cx - 1, cy, p.gold); put(cx + 1, cy, p.gold);
    put(cx, cy, p.pink);
  } else if (species < 0.60) {
    // bud
    put(cx, cy, p.pink); put(cx, cy - 1, p.pinkLight);
  } else if (species < 0.74) {
    // bluebell
    put(cx - 1, cy, p.blue); put(cx, cy, p.blue); put(cx + 1, cy, p.blue);
    put(cx - 1, cy + 1, p.blue); put(cx + 1, cy + 1, p.blue);
    put(cx, cy - 1, p.blueLight);
  } else if (species < 0.88) {
    // white daisy
    put(cx, cy - 1, p.white); put(cx, cy + 1, p.white);
    put(cx - 1, cy, p.white); put(cx + 1, cy, p.white);
    put(cx, cy, p.gold);
  } else {
    // rose: tight double
    put(cx, cy, p.pink); put(cx + 1, cy, p.pinkLight);
    put(cx, cy - 1, p.pinkLight); put(cx + 1, cy - 1, p.pink);
  }
}

function grassTuft(put: Put, rng: () => number, p: Palette,
                   x: number, ground: number): void {
  const h = 1 + Math.floor(rng() * 2);
  for (let i = 1; i <= h; i++) put(x, ground - i, p.grass);
  if (rng() < 0.5) put(x + 1, ground - 1, p.grass);
}

// the cottage, ported pixel-for-pixel from the v3 art (its lit window
// now reads the palette's gold; smoke reads the room's muted ink)
const COTTAGE: [number, number, number, number, string][] = [
  [11, 3, 6, 1, "#a05a45"],
  [9, 4, 10, 1, "#8a4b3b"], [7, 5, 14, 1, "#8a4b3b"], [5, 6, 18, 1, "#8a4b3b"],
  [3, 7, 22, 1, "#7d4232"],
  [19, 2, 2, 3, "#5a5044"],
  [5, 8, 18, 10, "#6b5d4b"],
  [5, 8, 18, 1, "#574c3d"],
  [8, 12, 3, 6, "#3a2f26"],
  [15, 11, 5, 5, "#4a3f33"],
  [4, 18, 20, 1, "#4a4438"],
];

class Garden {
  private seed = Math.floor(Math.random() * 2 ** 31);
  private bed: HTMLCanvasElement;
  private vineL: HTMLCanvasElement;
  private vineR: HTMLCanvasElement;
  private cottage: HTMLCanvasElement;
  private resizeTimer: number | undefined;

  constructor() {
    this.bed = document.querySelector<HTMLCanvasElement>(".garden canvas")!;
    this.vineL = document.querySelector<HTMLCanvasElement>(".vine-l")!;
    this.vineR = document.querySelector<HTMLCanvasElement>(".vine-r")!;
    this.cottage = document.querySelector<HTMLCanvasElement>(".cottage-c")!;
    // theme switch = same garden, new inks — repaint WITHOUT the bloom
    // animation (re-blooming mid-switch is the glitch, see below)
    store.on("theme", () => this.grow(false));
    const ro = new ResizeObserver(() => {
      clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => this.grow(false), 150);
    });
    ro.observe(this.bed);
    ro.observe(this.vineL);
    this.grow(true);
  }

  /** (Re)draw every layer from the session seed + active palette.
      bloom=true plays the sprout animation (first paint / toggle-on). */
  grow(bloom = false): void {
    if (document.body.classList.contains("no-garden")) return;
    const p = gardenPalette();
    this.drawBed(p);
    this.drawVine(this.vineL, p, this.seed ^ 0x1eaf);
    this.drawVine(this.vineR, p, this.seed ^ 0xb10b);
    this.drawCottage(p);
    if (bloom) this.rebloom(this.bed);
  }

  private ctxFor(c: HTMLCanvasElement): [CanvasRenderingContext2D, number, number] {
    // offsetWidth/Height, NEVER getBoundingClientRect: the bloom
    // animation scales transform, and a rect measured mid-bloom sized
    // the bed canvas 1px tall — the "flowers glitch on theme switch"
    // bug (Ben, feedback r3). Layout boxes ignore transforms.
    const w = Math.max(1, Math.floor(c.offsetWidth / PX));
    const h = Math.max(1, Math.floor(c.offsetHeight / PX));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, w, h);
    return [ctx, w, h];
  }

  private drawBed(p: Palette): void {
    const [ctx, w, h] = this.ctxFor(this.bed);
    const rng = mulberry32(this.seed);
    const put: Put = (x, y, color) => {
      if (x >= 0 && x < w && y >= 0 && y < h) {
        ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1);
      }
    };
    const ground = h; // soil sits just below the lane's bottom edge
    // scattered soil specks along the foot
    for (let x = 0; x < w; x++) {
      if (rng() < 0.24) put(x, h - 1, p.soil);
    }
    // one walk across the lane: flowers with jittered gaps, grass between
    let x = 2 + Math.floor(rng() * 6);
    while (x < w - 4) {
      if (rng() < 0.72) flower(put, rng, p, x, ground);
      else grassTuft(put, rng, p, x, ground);
      if (rng() < 0.35) grassTuft(put, rng, p, x + 2 + Math.floor(rng() * 3), ground);
      x += 5 + Math.floor(rng() * 14);
    }
  }

  private drawVine(c: HTMLCanvasElement, p: Palette, seed: number): void {
    const [ctx, w, h] = this.ctxFor(c);
    const rng = mulberry32(seed);
    const put: Put = (x, y, color) => {
      if (x >= 0 && x < w && y >= 0 && y < h) {
        ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1);
      }
    };
    // a climbing stem wandering up from the ground, thinning with gaps
    let x = 2 + Math.floor(rng() * 2);
    for (let y = h - 1; y >= 0; y--) {
      if (rng() < 0.06) continue;                    // small gaps — organic
      put(x, y, p.stem);
      if (rng() < 0.16) x += rng() < 0.5 ? -1 : 1;
      x = Math.max(0, Math.min(w - 2, x));
      if (rng() < 0.16) put(x + (rng() < 0.5 ? -1 : 1), y, p.leaf);
      if (rng() < 0.045) {                           // a blossom on the vine
        const bx = x + (rng() < 0.5 ? -1 : 1), by = y;
        put(bx, by, p.pink); put(bx + 1, by, p.pinkLight);
        put(bx, by - 1, p.pinkLight);
        if (rng() < 0.5) put(bx + 1, by - 1, p.gold);
      }
    }
  }

  private drawCottage(p: Palette): void {
    const [ctx] = this.ctxFor(this.cottage);
    const rng = mulberry32(this.seed ^ 0xc077);
    for (const [x, y, w2, h2, color] of COTTAGE) {
      ctx.fillStyle = color; ctx.fillRect(x, y, w2, h2);
    }
    // smoke in the room's ink, window + knob in the room's gold
    ctx.fillStyle = theme.muted; ctx.globalAlpha = 0.35;
    ctx.fillRect(20, 0, 1, 1); ctx.fillRect(22, 1, 1, 1);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.numerics;
    ctx.fillRect(16, 12, 3, 3); ctx.fillRect(10, 15, 1, 1);
    ctx.fillStyle = "#4a3f33";
    ctx.fillRect(17, 12, 1, 3); ctx.fillRect(16, 13, 3, 1);
    // doorstep flowers
    const put: Put = (x, y, color) => {
      ctx.fillStyle = color; ctx.fillRect(x, y, 1, 1);
    };
    flower(put, rng, gardenPalette(), 2, 19);
    if (rng() < 0.8) flower(put, rng, gardenPalette(), 25, 19);
  }

  /** Retrigger the bloom animation (no-op under reduced motion). */
  private rebloom(c: HTMLCanvasElement): void {
    c.style.animation = "none";
    void c.offsetWidth;
    c.style.animation = "";
  }
}

let garden: Garden | null = null;

export function initGarden(): void {
  if (!garden) garden = new Garden();
}

/** Called when the ⚙ garden toggle flips back on (canvas was display:
    none, so sizes were stale) — that path blooms; plain repaints don't. */
export function regrowGarden(bloom = false): void {
  garden?.grow(bloom);
}
