/* Screen-space annotations only. Geometry and picking remain independent. GPLv3. */
import type { Fact } from "./state";

export interface LabelRect { x: number; y: number; w: number; h: number }
export interface FieldLabel extends LabelRect { id: number; lines: string[] }
export interface LabelStatus {
  mode: "auto" | "off"; accepted: number; measured: number; visible: number;
  layoutMs: number; rebuilds: number; labels: FieldLabel[];
}
export interface LabelView {
  w: number; h: number; cx: number; cy: number; scale: number; ui: number;
  selected: ReadonlySet<number>; hover: number | null; highlighted: ReadonlySet<number>;
  exclusions: LabelRect[];
}
export const overlaps = (a: LabelRect, b: LabelRect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

class Grid {
  private cells = new Map<number, LabelRect[]>();
  private dots: Uint8Array;
  private dotCols: number;
  constructor(private cols: number, width: number, height: number) {
    this.dotCols = Math.ceil(width / 8);
    this.dots = new Uint8Array(this.dotCols * Math.ceil(height / 8));
  }
  addDot(x: number, y: number, r: number): void {
    const x0 = Math.max(0, Math.floor((x - r) / 8)), x1 = Math.min(this.dotCols, Math.ceil((x + r) / 8));
    const y0 = Math.max(0, Math.floor((y - r) / 8)), y1 = Math.min(this.dots.length / this.dotCols, Math.ceil((y + r) / 8));
    for (let row = y0; row < y1; row++) this.dots.fill(1, row * this.dotCols + x0, row * this.dotCols + x1);
  }
  private visit(r: LabelRect, fn: (key: number) => boolean): boolean {
    for (let y = Math.max(0, Math.floor(r.y / 32)); y <= Math.floor((r.y + r.h) / 32); y++)
      for (let x = Math.max(0, Math.floor(r.x / 32)); x <= Math.floor((r.x + r.w) / 32); x++)
        if (fn(y * this.cols + x)) return true;
    return false;
  }
  add(r: LabelRect): void {
    this.visit(r, key => { const cell = this.cells.get(key); if (cell) cell.push(r); else this.cells.set(key, [r]); return false; });
  }
  hits(r: LabelRect): boolean {
    const x0 = Math.max(0, Math.floor(r.x / 8)), x1 = Math.min(this.dotCols, Math.ceil((r.x + r.w) / 8));
    for (let y = Math.max(0, Math.floor(r.y / 8)); y < Math.ceil((r.y + r.h) / 8); y++)
      for (let x = x0; x < x1; x++) if (this.dots[y * this.dotCols + x]) return true;
    return this.visit(r, key => (this.cells.get(key) ?? []).some(other => overlaps(r, other)));
  }
}

// Intl.Segmenter is available in the shipped Chromium runtime. Never split a grapheme.
const segmenter = new (Intl as any).Segmenter(undefined, { granularity: "grapheme" });
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s: any) => s.segment);
}
export function wrapLabel(text: string, width: number, count: number,
                          measure: (s: string) => number): string[] {
  // Bound work even for a multi-megabyte fact. Slice only at grapheme boundaries.
  const normalized = text.replace(/\s+/gu, " ").trim();
  const chars: string[] = [];
  for (const s of segmenter.segment(normalized)) {
    chars.push(s.segment); if (chars.length >= 180) break;
  }
  const shortened = chars.join("").length < normalized.length;
  const lines: string[] = [];
  let pos = 0;
  while (pos < chars.length && lines.length < count) {
    let lo = pos, hi = chars.length;
    const last = lines.length === count - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const suffix = last && (mid < chars.length || shortened) ? "…" : "";
      if (measure(chars.slice(pos, mid).join("") + suffix) <= width) lo = mid;
      else hi = mid - 1;
    }
    if (lo === pos) return [];
    let end = lo;
    if (!last && end < chars.length) {
      const space = chars.lastIndexOf(" ", end - 1);
      if (space > pos + (end - pos) / 2) end = space;
    }
    const clipped = last && (end < chars.length || shortened);
    lines.push(chars.slice(pos, end).join("").trim() + (clipped ? "…" : ""));
    pos = end; while (chars[pos] === " ") pos++;
  }
  return lines;
}

export class FieldLabels {
  private rows: Fact[] = [];
  private revision = 0;
  private key = "";
  private textCache = new Map<string, { lines: string[]; width: number }>();
  private info: LabelStatus = { mode: "auto", accepted: 0, measured: 0, visible: 0, layoutMs: 0, rebuilds: 0, labels: [] };
  sync(facts: Iterable<Fact>): void {
    this.rows = Array.from(facts).sort((a, b) => a.fact_id - b.fact_id);
    this.textCache.clear(); this.invalidate();
  }
  invalidate(): void { this.revision++; }
  status(): LabelStatus { return { ...this.info, labels: this.info.labels.map(l => ({ ...l, lines: [...l.lines] })) }; }
  layout(ctx: CanvasRenderingContext2D, v: LabelView, mode: "auto" | "off"): readonly FieldLabel[] {
    const key = JSON.stringify([this.revision, mode, v.w, v.h, v.cx, v.cy, v.scale, v.ui,
      v.hover, v.exclusions]);
    if (key === this.key) return this.info.labels;
    this.key = key;
    const start = performance.now();
    const info: LabelStatus = { mode, accepted: 0, measured: 0, visible: 0, layoutMs: 0, rebuilds: this.info.rebuilds + 1, labels: [] };
    this.info = info;
    if (mode === "off" || v.w <= 0 || v.h <= 0) return info.labels;
    const grid = new Grid(Math.ceil(v.w / 32) + 2, v.w, v.h);
    v.exclusions.forEach(r => grid.add(r));
    type Point = { f: Fact; x: number; y: number; r: number };
    const priority: Point[][] = [[], [], []];
    const bins: Point[][] = Array.from({ length: 64 }, () => []);
    for (const f of this.rows) {
      if (f.x === null || f.y === null) continue;
      const x = (f.x - v.cx) * v.scale + v.w / 2, y = (f.y - v.cy) * v.scale + v.h / 2;
      if (x < -20 || y < -20 || x > v.w + 20 || y > v.h + 20) continue;
      const r = Math.max(2, Math.min(8, 2 + Math.log(1 + f.retrieval_count) * 1.5)) + 7;
      grid.addDot(x, y, r);
      info.visible++;
      if (x < 0 || y < 0 || x >= v.w || y >= v.h) continue;
      const rank = v.selected.has(f.fact_id) ? 0 : f.fact_id === v.hover ? 1 : v.highlighted.has(f.fact_id) ? 2 : -1;
      if (rank >= 0) { if (priority[rank].length < 256) priority[rank].push({ f, x, y, r }); }
      else {
        const bin = bins[Math.floor(y / v.h * 8) * 8 + Math.floor(x / v.w * 8)];
        if (bin.length < 4) bin.push({ f, x, y, r });
      }
    }
    const candidates = priority.flat().slice(0, 256);
    for (let round = 0; round < 4 && candidates.length < 256; round++)
      for (const bin of bins) if (bin[round] && candidates.length < 256) candidates.push(bin[round]);
    const font = 12 * v.ui, line = 16 * v.ui, pad = 3 * v.ui;
    ctx.font = `${font}px ui-monospace, monospace`;
    for (const point of candidates) {
      if (info.accepted >= 48) break;
      // Reject fully blocked anchors before shaping text. These small boxes are
      // contained in every possible label at each anchor, so no fitting label is lost.
      const minW = 20 * v.ui, minH = line + pad * 2;
      const { x: px, y: py, r: pr } = point;
      if ([[px + pr + 8, py - minH / 2], [px - pr - 8 - minW, py - minH / 2],
        [px - minW / 2, py - pr - 8 - minH], [px - minW / 2, py + pr + 8]]
        .every(([x, y]) => grid.hits({ x, y, w: minW, h: minH }))) continue;
      info.measured++;
      const text = `f#${String(point.f.fact_id).padStart(4, "0")} · ${point.f.content}`;
      let placed = false;
      for (const count of [2, 1]) {
        if (placed) break;
        const maxWidth = Math.min((count === 2 ? 208 : 152) * v.ui, v.w - 24);
        const cacheKey = `${point.f.fact_id}/${v.ui}/${maxWidth}/${count}`;
        let measured = this.textCache.get(cacheKey);
        if (!measured) {
          const lines = wrapLabel(text, maxWidth, count, s => ctx.measureText(s).width);
          measured = { lines, width: Math.max(0, ...lines.map(s => ctx.measureText(s).width)) };
          if (this.textCache.size >= 2048) this.textCache.clear();
          this.textCache.set(cacheKey, measured);
        }
        const { lines } = measured;
        if (!lines.length) continue;
        const width = measured.width + pad * 2;
        const height = lines.length * line + pad * 2;
        const { x, y, r } = point;
        for (const [left, top] of [[x + r + 8, y - height / 2], [x - r - 8 - width, y - height / 2],
          [x - width / 2, y - r - 8 - height], [x - width / 2, y + r + 8]]) {
          const rect = { x: left, y: top, w: width, h: height };
          if (left < 6 || top < 6 || left + width > v.w - 6 || top + height > v.h - 6 || grid.hits(rect)) continue;
          info.labels.push({ ...rect, id: point.f.fact_id, lines }); grid.add(rect);
          info.accepted++; placed = true; break;
        }
      }
    }
    info.layoutMs = performance.now() - start;
    return info.labels;
  }
}
