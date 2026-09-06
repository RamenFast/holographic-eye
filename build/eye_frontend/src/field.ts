/* The Field — 2D canvas of the real HRR geometry (PART 6 §3).
   Positions come from field.projection (server-side PCA in the
   similarity-preserving embedding). Camera is instant; animation
   budget is spent on data changes only.

   Render discipline (D-0009): the canvas is dirty-flag driven — a frame
   is drawn only when something changed (camera, hover, data, selection,
   highlight, lens, halo) or while transient effects are animating.
   Idle cost target: <1% CPU. GPLv3 — see LICENSE. */

import { store, catColor, fid, Fact, theme, rgba } from "./state";
import { GeometryHitTester, type GeometryStatus } from "./geometry";
import { FieldLabels, wrapLabel, type LabelRect } from "./field-labels";

interface Effect {
  kind: "arrival" | "ripple" | "bankpulse" | "trust";
  factId?: number;
  x: number; y: number;           // world coords
  start: number;                  // ms
  duration: number;
  category?: string;
  radius?: number;
}

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

export class Field {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private tooltip: HTMLElement;
  private mathLog: HTMLElement;

  // camera: screen = (world - cx) * scale + viewport/2
  private scale = 1;
  private initialFitPending = true;
  private hasProjectedFacts = false;
  private cx = 0;
  private cy = 0;
  private dragging = false;
  private panMoved = false;
  private spaceHeld = false;
  private lastMouse = { x: 0, y: 0 };
  private stripHits: { x: number; y: number; id: number }[] = [];
  private hoverId: number | null = null;
  private hoverAt = 0;
  private tooltipShown = false;
  private effects: Effect[] = [];
  private dragRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  private rafPending = false;
  private tooltipTimer: number | undefined;
  private geometry = new GeometryHitTester();
  private labels = new FieldLabels();
  private active = true;
  private labelMode: "auto" | "off" = "auto";
  private container: HTMLElement;
  private nullTotal = 0;

  setActive(active: boolean): void {
    this.active = active;
    if (!active) {
      this.hoverId = null; this.spaceHeld = false; this.dragging = false; this.dragRect = null;
      clearTimeout(this.tooltipTimer); this.tooltip.style.display = "none";
    } else this.requestDraw();
  }
  setLabelMode(mode: "auto" | "off"): void { this.labelMode = mode; this.invalidateLabels(); }
  getLabelMode(): "auto" | "off" { return this.labelMode; }
  labelStatus() { return { ...this.labels.status(), mode: this.labelMode, active: this.active,
    vectorlessTotal: this.nullTotal, vectorlessVisible: this.stripHits.length }; }
  invalidateLabels(): void { this.labels.invalidate(); this.requestDraw(); }
  zoomBy(factor: number): void {
    const { w, h } = this.view();
    if (!this.active || w <= 0 || h <= 0 || !Number.isFinite(factor) || factor <= 0) return;
    const base = this.fitScale(w, h);
    this.scale = Math.max(base * 0.5, Math.min(base * 8, this.scale * factor));
    this.requestDraw();
  }
  private fitScale(w: number, h: number): number {
    return Math.min(w * 0.86 / ((this.bounds.maxX - this.bounds.minX) || 1),
      h * 0.82 / ((this.bounds.maxY - this.bounds.minY) || 1));
  }
  private inputAllowed(target?: EventTarget | null): boolean {
    if (!this.active || this.container.closest("[hidden], [inert]")) return false;
    if (document.querySelector('dialog[open], [role="dialog"]:not([hidden])')) return false;
    const el = target instanceof Element ? target : document.activeElement;
    return !el?.closest('input, textarea, select, button, a, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="slider"], [role="combobox"]');
  }

  constructor(container: HTMLElement) {
    this.container = container;
    this.canvas = container.querySelector("canvas.fieldc")!;
    this.ctx = this.canvas.getContext("2d")!;
    this.tooltip = container.querySelector<HTMLElement>(".tooltip")!;
    this.mathLog = container.querySelector<HTMLElement>(".mathlog")!;
    this.bindInput();
    this.geometry.sync(store.facts.values());
    this.labels.sync(store.facts.values());
    this.computeBounds();
    store.on("facts", () => {
      this.geometry.sync(store.facts.values());
      this.labels.sync(store.facts.values());
      this.computeBounds();
      this.requestDraw();
    });
    store.on("selection", () => this.invalidateLabels());
    store.on("entities", () => this.invalidateLabels());   // entity highlight lives here
    store.on("trustlens", () => this.invalidateLabels());
    store.on("halo", () => this.invalidateLabels());
    store.on("theme", () => this.requestDraw());      // dots re-ink with the room
    new ResizeObserver(() => this.requestDraw()).observe(this.canvas);
    this.requestDraw();
  }

  /** Schedule one frame; keeps itself alive only while animations run. */
  requestDraw(): void {
    if (!this.active || this.rafPending || this.container.closest("[hidden], [inert]")) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      const drawn = this.draw();
      if (drawn && (this.effects.length || (store.reasonHalo && !reducedMotion))) {
        this.requestDraw();
      }
    });
  }

  // -- coordinate transforms -------------------------------------------------

  private view() {
    const r = this.canvas.getBoundingClientRect();
    return { w: r.width, h: r.height, left: r.left, top: r.top };
  }

  toScreen(wx: number, wy: number): [number, number] {
    const { w, h } = this.view();
    return [(wx - this.cx) * this.scale + w / 2, (wy - this.cy) * this.scale + h / 2];
  }

  toWorld(sx: number, sy: number): [number, number] {
    const { w, h } = this.view();
    return [(sx - w / 2) / this.scale + this.cx, (sy - h / 2) / this.scale + this.cy];
  }

  private computeBounds(): void {
    const xs: number[] = [], ys: number[] = [];
    for (const f of store.facts.values()) {
      if (f.x !== null && f.y !== null) { xs.push(f.x); ys.push(f.y!); }
    }
    this.hasProjectedFacts = xs.length > 0;
    if (!xs.length) return;
    this.bounds = {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minY: Math.min(...ys), maxY: Math.max(...ys),
    };

  }

  fit(): void {
    if (!this.active || this.container.closest("[hidden], [inert]")) return;
    const { w, h } = this.view();
    if (w <= 0 || h <= 0) return;
    this.fitCamera(w, h);
    this.requestDraw();
  }

  private fitCamera(w: number, h: number): void {
    this.scale = this.fitScale(w, h);
    const b = this.bounds;
    this.cx = (b.minX + b.maxX) / 2;
    this.cy = (b.minY + b.maxY) / 2;
    if (this.hasProjectedFacts) this.initialFitPending = false;
  }

  resetCamera(): void { this.fit(); }

  geometryStatus(): Readonly<GeometryStatus> { return this.geometry.status(); }

  // -- data-change effects (called from main on WS events) ---------------------

  arrival(f: Fact): void {
    if (f.x === null || reducedMotion) return;
    const now = performance.now();
    this.effects.push({ kind: "arrival", factId: f.fact_id, x: f.x, y: f.y!,
                        start: now, duration: 400 });
    const neighbors = this.nearest(f, 5);
    neighbors.forEach((n, i) => {
      this.effects.push({ kind: "ripple", x: n.x!, y: n.y!,
                          start: now + 80 * i, duration: 600 });
    });
    this.requestDraw();
  }

  bankPulse(category: string): void {
    if (reducedMotion) return;
    let sx = 0, sy = 0, n = 0;
    for (const f of store.facts.values()) {
      if (f.category === category && f.x !== null) { sx += f.x; sy += f.y!; n++; }
    }
    if (!n) return;
    this.effects.push({ kind: "bankpulse", x: sx / n, y: sy / n, category,
                        start: performance.now(), duration: 1500 });
    this.requestDraw();
  }

  private nearest(f: Fact, k: number): Fact[] {
    const out: { d: number; f: Fact }[] = [];
    for (const g of store.facts.values()) {
      if (g.fact_id === f.fact_id || g.x === null) continue;
      const d = (g.x - f.x!) ** 2 + (g.y! - f.y!) ** 2;
      out.push({ d, f: g });
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, k).map((o) => o.f);
  }

  logMath(lines: string[]): void {
    this.mathLog.textContent = lines.join("\n");
    this.mathLog.scrollTop = this.mathLog.scrollHeight;
  }

  // -- input -------------------------------------------------------------------

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener("wheel", (e) => {
      if (!this.inputAllowed(e.target)) return;
      e.preventDefault();
      const { w, h } = this.view();
      if (w <= 0 || h <= 0) return;
      const wx = (e.offsetX - w / 2) / this.scale + this.cx;
      const wy = (e.offsetY - h / 2) / this.scale + this.cy;
      const factor = Math.exp(-e.deltaY * 0.0015);
      const base = this.fitScale(w, h);
      this.scale = Math.max(base * 0.5, Math.min(base * 8, this.scale * factor));
      this.cx += wx - ((e.offsetX - w / 2) / this.scale + this.cx);
      this.cy += wy - ((e.offsetY - h / 2) / this.scale + this.cy);
      this.requestDraw();
    }, { passive: false });

    c.addEventListener("mousedown", (e) => {
      if (!this.inputAllowed(e.target)) return;
      this.lastMouse = { x: e.offsetX, y: e.offsetY };
      const hit = this.hitTest(e.offsetX, e.offsetY);
      // §3.7: drag on empty space pans; shift+drag = region select;
      // space+drag always pans (even over a dot)
      if (this.spaceHeld) {
        this.dragging = true;
      } else if (hit === null) {
        if (e.shiftKey) {
          this.dragRect = { x0: e.offsetX, y0: e.offsetY, x1: e.offsetX, y1: e.offsetY };
        } else {
          this.dragging = true;
        }
      }
    });

    c.addEventListener("mousemove", (e) => {
      if (!this.inputAllowed(e.target)) return;
      const dx = e.offsetX - this.lastMouse.x, dy = e.offsetY - this.lastMouse.y;
      if (this.dragging) {
        this.cx -= dx / this.scale; this.cy -= dy / this.scale;
        if (Math.abs(dx) + Math.abs(dy) > 1) this.panMoved = true;
        this.requestDraw();
      } else if (this.dragRect) {
        this.dragRect.x1 = e.offsetX; this.dragRect.y1 = e.offsetY;
        this.requestDraw();
      } else {
        const hit = this.hitTest(e.offsetX, e.offsetY);
        if (hit !== this.hoverId) {
          this.hoverId = hit; this.hoverAt = performance.now(); this.tooltipShown = false;
          // one frame now (ring the dot), one after the 200ms tooltip delay
          clearTimeout(this.tooltipTimer);
          if (hit !== null) this.tooltipTimer = window.setTimeout(() => this.requestDraw(), 210);
          this.requestDraw();
        }
      }
      this.lastMouse = { x: e.offsetX, y: e.offsetY };
    });

    c.addEventListener("mouseup", (e) => {
      if (!this.inputAllowed(e.target)) return;
      if (this.dragRect) {
        const r = this.dragRect; this.dragRect = null;
        this.requestDraw();
        if (Math.abs(r.x1 - r.x0) > 6 && Math.abs(r.y1 - r.y0) > 6) {
          const [ax, ay] = this.toWorld(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1));
          const [bx, by] = this.toWorld(Math.max(r.x0, r.x1), Math.max(r.y0, r.y1));
          const ids: number[] = [];
          for (const f of store.facts.values()) {
            if (f.x !== null && f.x >= ax && f.x <= bx && f.y! >= ay && f.y! <= by) {
              ids.push(f.fact_id);
            }
          }
          if (ids.length) store.select(ids);
          return;
        }
      }
      if (this.dragging) {
        this.dragging = false;
        const moved = Math.hypot(e.offsetX - this.lastMouse.x, e.offsetY - this.lastMouse.y);
        // a pan that never moved is a click on empty space → clear selection
        if (moved > 3 || this.panMoved) { this.panMoved = false; return; }
      }
      const hit = this.hitTest(e.offsetX, e.offsetY);
      if (hit !== null) store.select([hit], e.shiftKey ? "add" : "set");
      else if (!e.shiftKey) store.clearSelection();
    });

    c.addEventListener("mouseleave", () => {
      this.hoverId = null;
      clearTimeout(this.tooltipTimer);
      this.requestDraw();
    });

    addEventListener("keydown", (e) => {
      if (!this.inputAllowed(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.code === "Space") { this.spaceHeld = true; e.preventDefault(); }
      if (e.key === "0") this.fit();
      if (e.key === "f" && !e.metaKey && !e.ctrlKey) this.fit();
    });
    addEventListener("keyup", (e) => {
      if (e.code === "Space") this.spaceHeld = false;
    });
  }

  private hitTest(sx: number, sy: number): number | null {
    // One viewport read and eight scalar arguments cross into WASM. The
    // interleaved coordinate buffer changes only when the facts change.
    const { w, h } = this.view();
    const best = this.geometry.hitTest(
      this.cx, this.cy, this.scale, w, h, sx, sy,
    );
    if (best === null) {
      for (const s of this.stripHits) {
        if ((s.x - sx) ** 2 + (s.y - sy) ** 2 < 49) return s.id;
      }
    }
    return best;
  }

  // -- render --------------------------------------------------------------------

  private draw(): boolean {
    if (!this.active || this.container.closest("[hidden], [inert]")) return false;
    const dpr = devicePixelRatio || 1;
    const viewport = this.view();
    const { w, h } = viewport;
    if (w <= 0 || h <= 0) return false;
    if (this.initialFitPending && this.hasProjectedFacts) this.fitCamera(w, h);
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr; this.canvas.height = h * dpr;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // hairline grid only — the old radial "depth" gradient banded into
    // visible rings on near-black displays (feedback r2 #1)
    ctx.strokeStyle = rgba(theme.inkRgb, theme.dark ? 0.025 : 0.05);
    ctx.lineWidth = 1;
    for (let x = 80; x < w; x += 80) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 80; y < h; y += 80) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    const now = performance.now();
    // Keep one stable viewport snapshot for this frame. Calling toScreen()
    // for every point would read layout N times through view().
    const screen = (wx: number, wy: number): [number, number] =>
      [(wx - this.cx) * this.scale + w / 2,
       (wy - this.cy) * this.scale + h / 2];
    const highlightOn = store.entityHighlight.size > 0;
    const halo = store.reasonHalo;

    // bank pulses under the dots
    for (const e of this.effects) {
      if (e.kind !== "bankpulse") continue;
      const t = (now - e.start) / e.duration;
      if (t < 0 || t > 1) continue;
      const [sx, sy] = screen(e.x, e.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 30 + t * 160, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(theme.numericsRgb, 0.08 * (1 - t));
      ctx.lineWidth = 20; ctx.stroke();
    }

    // Only visible rings become draws/hits. Browser views retain every fact.
    this.stripHits = [];
    this.nullTotal = 0;
    const ui = Math.max(0.5, parseFloat(getComputedStyle(document.documentElement).fontSize) / 13 || 1);
    const ringY = h - 18;
    const capacity = Math.max(0, Math.floor((w - 32) / 10));
    for (const f of store.facts.values()) {
      if (f.has_vector) continue;
      this.nullTotal++;
      if (this.stripHits.length >= capacity) continue;
      const ringX = 16 + this.stripHits.length * 10;
      ctx.beginPath(); ctx.arc(ringX, ringY, 3, 0, Math.PI * 2);
      ctx.strokeStyle = f.fact_id === this.hoverId ? theme.acting : rgba(theme.inkRgb, 0.6);
      ctx.lineWidth = 1; ctx.stroke();
      this.stripHits.push({ x: ringX, y: ringY, id: f.fact_id });
    }
    if (this.nullTotal) {
      ctx.fillStyle = rgba(theme.inkRgb, 0.7);
      ctx.font = `${11 * ui}px ui-monospace, monospace`;
      const caption = `${this.nullTotal} without vectors · ${this.stripHits.length} rings · all in Categories / Timeline`;
      const line = wrapLabel(caption, Math.max(0, w - 32), 1, text => ctx.measureText(text).width)[0];
      if (line) ctx.fillText(line, 16, ringY - 14);
      this.canvas.setAttribute("aria-label", `Fact projection. ${caption}`);
    } else {
      this.canvas.setAttribute("aria-label", "Fact projection");
    }

    const lens = store.trustLens;

    // dots
    for (const f of store.facts.values()) {
      if (f.x === null) continue;
      const [sx, sy] = screen(f.x, f.y!);
      if (sx < -20 || sy < -20 || sx > w + 20 || sy > h + 20) continue;
      let alpha = 0.55 + f.trust_score * 0.45;
      if (highlightOn && !store.entityHighlight.has(f.fact_id)) alpha *= 0.12;
      if (halo && !halo.factIds.has(f.fact_id)) alpha *= 0.35;
      if (lens.mode !== "off") {
        const passes = lens.mode === "above"
          ? f.trust_score >= lens.value : f.trust_score < lens.value;
        if (!passes) alpha *= 0.07;
      }
      const r = Math.max(2, Math.min(8, 2 + Math.log(1 + f.retrieval_count) * 1.5));

      // arrival scale/opacity
      let scaleMod = 1;
      const arr = this.effects.find((e) => e.kind === "arrival" && e.factId === f.fact_id);
      if (arr) {
        const t = Math.min(1, (now - arr.start) / arr.duration);
        const ease = 1 - Math.pow(1 - t, 3);
        scaleMod = 0.6 + 0.4 * ease; alpha *= ease;
      }

      ctx.beginPath();
      ctx.arc(sx, sy, r * scaleMod, 0, Math.PI * 2);
      ctx.fillStyle = catColor(f.category, f.trust_score, alpha);
      ctx.fill();

      if (store.selection.has(f.fact_id)) {
        ctx.beginPath(); ctx.arc(sx, sy, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = theme.acting; ctx.lineWidth = 1.25; ctx.stroke();
      } else if (f.fact_id === this.hoverId) {
        ctx.beginPath(); ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(theme.actingRgb, 0.6); ctx.lineWidth = 1; ctx.stroke();
      } else if (highlightOn && store.entityHighlight.has(f.fact_id)) {
        // entity highlight: ring the structural hits, don't just dim the rest
        ctx.beginPath(); ctx.arc(sx, sy, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(theme.actingRgb, 0.45); ctx.lineWidth = 1; ctx.stroke();
      }
      if (halo && halo.factIds.has(f.fact_id)) {
        ctx.beginPath(); ctx.arc(sx, sy, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(theme.numericsRgb, 0.8); ctx.lineWidth = 2; ctx.stroke();
      }
    }

    // ripples above dots
    this.effects = this.effects.filter((e) => now - e.start < e.duration + 400);
    for (const e of this.effects) {
      if (e.kind !== "ripple") continue;
      const t = (now - e.start) / e.duration;
      if (t < 0 || t > 1) continue;
      const [sx, sy] = screen(e.x, e.y);
      ctx.beginPath();
      ctx.arc(sx, sy, 2 + t * 38, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(theme.numericsRgb, 0.4 * (1 - t));
      ctx.lineWidth = 1; ctx.stroke();
    }

    // reason halo rings on entity centroids (breathing)
    if (halo) {
      for (const name of halo.entities) {
        let sx = 0, sy = 0, n = 0;
        for (const f of store.facts.values()) {
          if (f.x !== null && f.entities.some((e) => e.toLowerCase() === name.toLowerCase())) {
            sx += f.x; sy += f.y!; n++;
          }
        }
        if (!n) continue;
        const [px, py] = screen(sx / n, sy / n);
        const breathe = reducedMotion ? 1 : 0.6 + 0.4 * Math.abs(Math.sin(now / 1200 * Math.PI));
        ctx.beginPath(); ctx.arc(px, py, 16 * breathe + 8, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(theme.numericsRgb, 0.55); ctx.lineWidth = 1.5; ctx.stroke();
      }
    }

    // drag-select rectangle
    if (this.dragRect) {
      const r = this.dragRect;
      ctx.strokeStyle = rgba(theme.actingRgb, 0.5); ctx.lineWidth = 1;
      ctx.strokeRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1),
                     Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
    }

    this.updateTooltip(now, w, h);
    if (this.labelMode === "auto") {
      const exclusions: LabelRect[] = [];
      const overlays = [
        ...this.container.querySelectorAll<HTMLElement>(".field-title, .context-rail, .context-read, .mathlog, .tooltip, .field-legend, .field-help, .garden-context, #field-context, [data-label-exclusion]"),
        ...document.querySelectorAll<HTMLElement>(".capacity-pop"),
      ];
      for (const el of overlays) {
        if (!el.getClientRects().length || getComputedStyle(el).display === "none") continue;
        const r = el.getBoundingClientRect();
        const x = Math.max(0, r.left - viewport.left), y = Math.max(0, r.top - viewport.top);
        const right = Math.min(w, r.right - viewport.left), bottom = Math.min(h, r.bottom - viewport.top);
        if (right > x && bottom > y) exclusions.push({ x, y, w: right - x, h: bottom - y });
      }
      if (this.nullTotal) exclusions.push({ x: 0, y: h - 38 - 16 * ui, w, h: 38 + 16 * ui });
      const labels = this.labels.layout(ctx, { w, h, cx: this.cx, cy: this.cy, scale: this.scale, ui,
        zoom: this.scale / this.fitScale(w, h), focused: store.focusedFact,
        tooltipId: this.tooltip.style.display === "block" ? this.hoverId : null,
        reason: halo?.factIds, trustLens: lens,
        selected: store.selection, hover: this.hoverId, highlighted: store.entityHighlight, exclusions }, this.labelMode);
      ctx.font = `${12 * ui}px ui-monospace, monospace`;
      ctx.textBaseline = "top";
      ctx.fillStyle = rgba(theme.inkRgb, 0.95);
      ctx.strokeStyle = rgba(theme.inkRgb, 0.45);
      ctx.lineWidth = 1;
      for (const label of labels) {
        ctx.beginPath();
        ctx.moveTo(label.stem.x + 0.5, label.stem.y);
        ctx.lineTo(label.stem.x + 0.5, label.stem.y + label.stem.h);
        ctx.stroke();
        label.lines.forEach((text, i) => ctx.fillText(text, label.x + 3 * ui, label.y + (3 + i * 16) * ui));
      }
      ctx.textBaseline = "alphabetic";
    } else this.labels.layout(ctx, { w, h, cx: this.cx, cy: this.cy, scale: this.scale, ui,
      zoom: this.scale / this.fitScale(w, h), selected: store.selection, hover: this.hoverId, highlighted: store.entityHighlight, exclusions: [] }, "off");
    return true;
  }

  private updateTooltip(now: number, w: number, h: number): void {
    const f = this.hoverId !== null ? store.facts.get(this.hoverId) : undefined;
    if (!f || this.dragging || this.dragRect) {
      this.tooltip.style.display = "none"; return;
    }
    if (now - this.hoverAt < 200 && !this.tooltipShown) return; // 200ms delay
    this.tooltipShown = true;

    let sx: number, sy: number;
    if (f.x === null) {
      // no-vector strip: teach, don't just label (feedback #8)
      const hit = this.stripHits.find((s) => s.id === f.fact_id);
      if (!hit) { this.tooltip.style.display = "none"; return; }
      [sx, sy] = [hit.x, hit.y - 8];
      this.tooltip.innerHTML =
        `<div class="hd">${fid(f.fact_id)} · <span>${escapeHtml(f.category)}</span> · trust ${f.trust_score.toFixed(2)}</div>` +
        `<div>“${escapeHtml(f.content.slice(0, 120))}${f.content.length > 120 ? "…" : ""}”</div>` +
        `<div class="edu">⊘ <b>no HRR vector.</b> This fact was stored while vector ` +
        `encoding was unavailable, so it exists only as text: keyword <i>search</i> still ` +
        `finds it, but it is invisible to <i>probe/reason</i> algebra and cannot be placed ` +
        `in the Field.</div>` +
        `<div class="edu">Fix: select it and use <b>backfill vector</b> — the Eye re-encodes ` +
        `it from its text + entities (journaled, undoable).</div>`;
      this.tooltip.style.display = "block";
      this.placeTooltip(sx + 14, sy - 150, w, h);
      return;
    }

    const near = this.nearest(f, 3)
      .map((n) => {
        const d = Math.hypot(n.x! - f.x!, n.y! - f.y!);
        return `<b>${fid(n.fact_id)}</b> (${d.toFixed(2)})`;
      }).join(" ");
    const trustNote = f.trust_score >= 0.7 ? "high — recalled eagerly"
      : f.trust_score >= 0.3 ? "mid — recalled normally"
      : "below min_trust 0.3 — filtered from recall";
    this.tooltip.innerHTML =
      `<div class="hd">${fid(f.fact_id)} · <span>${escapeHtml(f.category)}</span> · trust ${f.trust_score.toFixed(2)}</div>` +
      `<div>“${escapeHtml(f.content.slice(0, 160))}${f.content.length > 160 ? "…" : ""}”</div>` +
      (f.entities.length
        ? `<div class="ents">⊙ entities: ${f.entities.map(escapeHtml).join(", ")}</div>`
        : `<div class="ents">no entities extracted — probe/reason can't target it</div>`) +
      `<div class="close">→ nearest in geometry: ${near}</div>` +
      `<div class="close">trust: ${trustNote}</div>` +
      `<div class="close">seen in ${f.retrieval_count} recall${f.retrieval_count === 1 ? "" : "s"} (journal-observed) · rated helpful ${f.helpful_count}×</div>`;
    this.tooltip.style.display = "block";
    [sx, sy] = [(f.x! - this.cx) * this.scale + w / 2, (f.y! - this.cy) * this.scale + h / 2];
    this.placeTooltip(sx + 14, sy + 12, w, h);
  }
  private placeTooltip(x: number, y: number, w: number, h: number): void {
    this.tooltip.style.maxWidth = `${Math.max(0, w - 24)}px`;
    this.tooltip.style.maxHeight = `${Math.max(0, h - 24)}px`;
    this.tooltip.style.boxSizing = "border-box";
    this.tooltip.style.overflow = "auto";
    const rect = this.tooltip.getBoundingClientRect();
    this.tooltip.style.left = `${Math.max(12, Math.min(x, w - rect.width - 12))}px`;
    this.tooltip.style.top = `${Math.max(12, Math.min(y, h - rect.height - 12))}px`;
  }
}

export function escapeHtml(s: unknown): string {
  const text = typeof s === "string" ? s : s == null ? "" :
    typeof s === "number" || typeof s === "boolean" ? String(s) : "[invalid text]";
  return text.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
