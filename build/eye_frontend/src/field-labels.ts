/* Screen-space annotations only. Geometry and picking remain independent. GPLv3. */
import type { Fact } from "./state";

export interface LabelRect { x: number; y: number; w: number; h: number }
export interface FieldLabel extends LabelRect { id: number; lines: string[]; stem: LabelRect }
export interface LabelStatus {
  mode: "auto" | "off"; accepted: number; measured: number; visible: number;
  layoutMs: number; rebuilds: number; labels: FieldLabel[];
}
export interface LabelView {
  w: number; h: number; cx: number; cy: number; scale: number; ui: number;
  selected: ReadonlySet<number>; hover: number | null; highlighted: ReadonlySet<number>;
  exclusions: LabelRect[];
  zoom: number; focused?: number | null; tooltipId?: number | null;
  reason?: ReadonlySet<number> | null;
  trustLens?: { mode: "off" | "above" | "below"; value: number };
}
export const overlaps = (a: LabelRect, b: LabelRect): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

class Grid {
  private cells = new Map<number, LabelRect[]>();
  private dots: Int32Array;
  private dotCols: number;
  constructor(private cols: number, width: number, height: number) {
    this.dotCols = Math.ceil(width / 8);
    this.dots = new Int32Array(this.dotCols * Math.ceil(height / 8));
  }
  addDot(x: number, y: number, r: number, owner: number): void {
    const x0 = Math.max(0, Math.floor((x - r) / 8)), x1 = Math.min(this.dotCols, Math.ceil((x + r) / 8));
    const y0 = Math.max(0, Math.floor((y - r) / 8)), y1 = Math.min(this.dots.length / this.dotCols, Math.ceil((y + r) / 8));
    for (let row = y0; row < y1; row++) for (let col = x0; col < x1; col++) {
      const i = row * this.dotCols + col;
      this.dots[i] = this.dots[i] === 0 || this.dots[i] === owner ? owner : -1;
    }
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
  hits(r: LabelRect, ignoreOwner = 0): boolean {
    const x0 = Math.max(0, Math.floor(r.x / 8)), x1 = Math.min(this.dotCols, Math.ceil((r.x + r.w) / 8));
    for (let y = Math.max(0, Math.floor(r.y / 8)); y < Math.ceil((r.y + r.h) / 8); y++)
      for (let x = x0; x < x1; x++) {
        const owner = this.dots[y * this.dotCols + x];
        if (owner && owner !== ignoreOwner) return true;
      }
    return this.visit(r, key => (this.cells.get(key) ?? []).some(other => overlaps(r, other)));
  }
}

// Intl.Segmenter is available in the shipped Chromium runtime. Never split a grapheme.
const segmenter = new (Intl as any).Segmenter(undefined, { granularity: "grapheme" });
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (s: any) => s.segment);
}
export function boundedText(text: string): string {
  if (text.length <= 2048) return text.replace(/\s+/gu, " ").trim();
  // The final grapheme of a sliced prefix may continue outside the prefix.
  const parts = graphemes(text.slice(0, 2048));
  parts.pop();
  return parts.join("").replace(/\s+/gu, " ").trim() + "…";
}
export function wrapLabel(text: string, width: number, count: number,
                          measure: (s: string) => number): string[] {
  // Bound work even for a multi-megabyte fact. Slice only at grapheme boundaries.
  const normalized = boundedText(text);
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
  status(): LabelStatus { return { ...this.info, labels: this.info.labels.map(l => ({ ...l, stem: { ...l.stem }, lines: [...l.lines] })) }; }
  layout(ctx: CanvasRenderingContext2D, v: LabelView, mode: "auto" | "off"): readonly FieldLabel[] {
    const tier = v.zoom < 1.25 ? 0 : v.zoom < 2.5 ? 1 : v.zoom < 4 ? 2 : 3;
    const cap = [2, 12, 24, 48][tier];
    const key = JSON.stringify([this.revision, mode, v.w, v.h, v.cx, v.cy, v.scale, v.ui,
      tier, v.hover, v.focused, v.tooltipId, v.exclusions]);
    if (key === this.key) return this.info.labels;
    this.key = key;
    const start = performance.now();
    const info: LabelStatus = { mode, accepted: 0, measured: 0, visible: 0, layoutMs: 0, rebuilds: this.info.rebuilds + 1, labels: [] };
    this.info = info;
    if (mode === "off" || v.w <= 0 || v.h <= 0) return info.labels;
    const grid = new Grid(Math.ceil(v.w / 32) + 2, v.w, v.h);
    v.exclusions.forEach(r => grid.add(r));
    type Point = { f: Fact; x: number; y: number; r: number; owner: number };
    const priority: Point[][] = [[], [], [], []];
    const bins: Point[][] = Array.from({ length: 64 }, () => []);
    for (const f of this.rows) {
      if (f.x === null || f.y === null) continue;
      const x = (f.x - v.cx) * v.scale + v.w / 2, y = (f.y - v.cy) * v.scale + v.h / 2;
      if (x < -20 || y < -20 || x > v.w + 20 || y > v.h + 20) continue;
      const r = Math.max(2, Math.min(8, 2 + Math.log(1 + f.retrieval_count) * 1.5)) + 7;
      const owner = ++info.visible;
      grid.addDot(x, y, r, owner);
      if (x < 0 || y < 0 || x >= v.w || y >= v.h || f.fact_id === v.tooltipId) continue;
      const intentional = f.fact_id === v.hover || f.fact_id === v.focused;
      if (tier === 0 && !intentional) continue;
      const lens = v.trustLens;
      const dimmed = (v.highlighted.size > 0 && !v.highlighted.has(f.fact_id)) ||
        (v.reason != null && !v.reason.has(f.fact_id)) ||
        (lens && lens.mode !== "off" && !(lens.mode === "above" ? f.trust_score >= lens.value : f.trust_score < lens.value));
      if (dimmed && !intentional && !v.selected.has(f.fact_id)) continue;
      const rank = f.fact_id === v.hover ? 0 : f.fact_id === v.focused ? 1 : v.selected.has(f.fact_id) ? 2 :
        v.highlighted.has(f.fact_id) || v.reason?.has(f.fact_id) ? 3 : -1;
      const point = { f, x, y, r, owner };
      if (rank >= 0) { if (priority[rank].length < 256) priority[rank].push(point); }
      else {
        const bin = bins[Math.floor(y / v.h * 8) * 8 + Math.floor(x / v.w * 8)];
        if (bin.length < 4) bin.push(point);
      }
    }
    const candidates = priority.flat().slice(0, 256);
    for (let round = 0; round < 4 && candidates.length < 256; round++)
      for (const bin of bins) if (bin[round] && candidates.length < 256) candidates.push(bin[round]);
    const font = 12 * v.ui, line = 16 * v.ui, pad = 3 * v.ui;
    ctx.font = `${font}px ui-monospace, monospace`;
    for (const point of candidates) {
      if (info.accepted >= cap) break;
      const top = point.y + point.r + 8 * v.ui;
      const minH = line + pad * 2;
      const stem = { x: point.x - 0.5, y: point.y + point.r, w: 1, h: 8 * v.ui };
      if (top + minH > v.h - 6 || grid.hits(stem, point.owner) ||
          grid.hits({ x: point.x - 10 * v.ui, y: top, w: 20 * v.ui, h: minH })) continue;
      info.measured++;
      const f = point.f;
      const content = boundedText(f.content), entity = boundedText(f.entities[0] ?? "");
      const tags = boundedText(f.tags), category = boundedText(f.category);
      const short = entity || tags || content || category;
      const preview = tier <= 1 ? short : content || short;
      const text = `f#${String(f.fact_id).padStart(4, "0")} · ${preview}`;
      for (const count of (tier <= 1 ? [1] : [2, 1])) {
        const maxWidth = Math.min((count === 2 ? 208 : 152) * v.ui, v.w - 24);
        const cacheKey = `${f.fact_id}/${tier}/${v.ui}/${maxWidth}/${count}`;
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
        const left = point.x - width / 2;
        const rect = { x: left, y: top, w: width, h: height };
        if (left < 6 || top < 6 || left + width > v.w - 6 || top + height > v.h - 6 || grid.hits(rect)) continue;
        info.labels.push({ ...rect, id: f.fact_id, lines, stem }); grid.add(rect); grid.add(stem);
        info.accepted++; break;
      }
    }
    info.layoutMs = performance.now() - start;
    return info.labels;
  }
}
