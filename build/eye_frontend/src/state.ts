/* Central state + pub/sub + the theme bridge for the Eye.
   Palettes are CSS token rows (styles.css, the sysmon/Phosphor way,
   D-0011); this module mirrors the active row into a typed object so
   canvas code draws with the same tokens the DOM wears. GPLv3. */

export interface Fact {
  fact_id: number;
  x: number | null;
  y: number | null;
  has_vector: boolean;
  content: string;
  category: string;
  tags: string;
  trust_score: number;
  retrieval_count: number;
  helpful_count: number;
  created_at: string;
  updated_at: string;
  entities: string[];
}

export interface EyeEvent {
  event_id: number;
  ts: string;
  session_id: string;
  source: string;
  kind: string;
  request: string | null;
  response: string | null;
  before: string | null;
  after: string | null;
  duration_ms: number | null;
  undone_by: number | null;
}

export interface EntityRow {
  entity_id: number;
  name: string;
  entity_type: string;
  aliases: string;
  fact_count: number;
}

type Listener = () => void;

class Store {
  facts = new Map<number, Fact>();
  projectionMeta: any = {};
  entities: EntityRow[] = [];
  entityTotal = 0;
  events: EyeEvent[] = [];           // stream buffer, oldest → newest, cap 400
  stats: any = {};
  wsStatus: "live" | "degraded" | "off" = "off";

  selection = new Set<number>();     // selected fact_ids, insertion order is meaningful
  focusedFact: number | null = null; // the fact in the Inspect pane
  private selectionHistory: { ids: number[]; focused: number | null }[] = [];
  private selectionHistoryIndex = -1;
  private restoringSelection = false;
  // entity highlight is a real set (r2 #3): every clicked entity stacks;
  // entityHighlight is the union of all per-entity hits, esc clears all
  entityHighlight = new Set<number>();
  highlightedEntities = new Map<string, Set<number>>(); // entity name → fact hits
  // trust lens: view facts above/below a draggable threshold (feedback #4)
  trustLens: { mode: "off" | "above" | "below"; value: number } =
    { mode: "off", value: 0.5 };
  probedRecently = new Map<string, number>(); // entity name (lower) → ts ms
  reasonHalo: { entities: string[]; factIds: Set<number> } | null = null;

  private listeners = new Map<string, Set<Listener>>();
  private eventIds = new Set<number>();

  on(topic: string, fn: Listener): void {
    if (!this.listeners.has(topic)) this.listeners.set(topic, new Set());
    this.listeners.get(topic)!.add(fn);
  }

  emit(topic: string): void {
    for (const fn of this.listeners.get(topic) ?? []) fn();
    for (const fn of this.listeners.get("*") ?? []) fn();
  }

  setFacts(facts: Fact[], meta: any): void {
    this.facts = new Map(facts.map((f) => [f.fact_id, f]));
    this.projectionMeta = meta;
    this.emit("facts");
  }

  private trackEvent(ev: EyeEvent): boolean {
    if (this.eventIds.has(ev.event_id)) return false;
    this.events.push(ev);
    this.eventIds.add(ev.event_id);
    try {
      const req = ev.request ? JSON.parse(ev.request) : {};
      const names: string[] = [];
      if (req.entity) names.push(String(req.entity));
      if (Array.isArray(req.entities)) names.push(...req.entities.map(String));
      for (const n of names) this.probedRecently.set(n.toLowerCase(), Date.now());
    } catch { /* not JSON */ }
    return true;
  }

  private trimEvents(): void {
    if (this.events.length <= 400) return;
    const removed = this.events.splice(0, this.events.length - 400);
    for (const ev of removed) this.eventIds.delete(ev.event_id);
  }

  pushEvent(ev: EyeEvent): void {
    if (!this.trackEvent(ev)) return;
    this.trimEvents();
    this.emit("events");
  }

  pushEvents(events: EyeEvent[]): void {
    let changed = false;
    for (const ev of events) changed = this.trackEvent(ev) || changed;
    if (!changed) return;
    this.events.sort((a, b) => a.event_id - b.event_id);
    this.trimEvents();
    this.emit("events");
  }

  private sameSelection(a: { ids: number[]; focused: number | null },
                        b: { ids: number[]; focused: number | null }): boolean {
    return a.focused === b.focused && a.ids.length === b.ids.length &&
      a.ids.every((id, i) => id === b.ids[i]);
  }

  private recordSelection(): void {
    if (this.restoringSelection || this.selection.size === 0) return;
    const snapshot = { ids: [...this.selection], focused: this.focusedFact };
    const current = this.selectionHistory[this.selectionHistoryIndex];
    if (current && this.sameSelection(current, snapshot)) return;
    this.selectionHistory.splice(this.selectionHistoryIndex + 1);
    this.selectionHistory.push(snapshot);
    if (this.selectionHistory.length > 50) this.selectionHistory.shift();
    this.selectionHistoryIndex = this.selectionHistory.length - 1;
  }

  select(ids: number[], mode: "set" | "add" = "set"): void {
    if (mode === "set") this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.focusedFact = ids.length ? ids[ids.length - 1] : this.focusedFact;
    if (!this.selection.size) this.focusedFact = null;
    this.recordSelection();
    this.emit("selection");
  }

  clearSelection(): void {
    this.selection.clear();
    this.focusedFact = null;
    this.emit("selection");
  }

  canNavigateSelectionHistory(direction: -1 | 1): boolean {
    let i = this.selectionHistoryIndex + direction;
    while (i >= 0 && i < this.selectionHistory.length) {
      if (this.selectionHistory[i].ids.some((id) => this.facts.has(id))) return true;
      i += direction;
    }
    return false;
  }

  navigateSelectionHistory(direction: -1 | 1): boolean {
    let i = this.selectionHistoryIndex + direction;
    while (i >= 0 && i < this.selectionHistory.length) {
      const snapshot = this.selectionHistory[i];
      const ids = snapshot.ids.filter((id) => this.facts.has(id));
      if (ids.length) {
        this.selectionHistoryIndex = i;
        this.restoringSelection = true;
        this.selection = new Set(ids);
        this.focusedFact = snapshot.focused != null && this.facts.has(snapshot.focused)
          ? snapshot.focused : ids[ids.length - 1];
        this.restoringSelection = false;
        this.emit("selection");
        return true;
      }
      i += direction;
    }
    return false;
  }
}

export const store = new Store();

// ---------------------------------------------------------------------------
// Theme bridge (D-0011) — palette rows live in styles.css; this mirrors
// the active row so the Field/FFT/garden draw with the DOM's tokens.
// ---------------------------------------------------------------------------

/* bg/ink/accent are PREVIEW swatches for the ⚙ theme chips only —
   the real tokens live in styles.css; keep both in step. */
export const THEMES: { id: string; label: string; dark: boolean;
                       bg: string; ink: string; accent: string }[] = [
  { id: "blossom_dark", label: "Blossom Dark", dark: true,
    bg: "#281821", ink: "#f5eaef", accent: "#ec8fac" },
  { id: "blossom", label: "Blossom", dark: false,
    bg: "#fcf4f3", ink: "#2b2128", accent: "#c85a7c" },
  { id: "amoled", label: "Blossom AMOLED", dark: true,
    bg: "#0a0a0a", ink: "#eef8ff", accent: "#db3776" },
  { id: "light", label: "Light", dark: false,
    bg: "#ffffff", ink: "#0e1620", accent: "#0c94a2" },
  { id: "dark", label: "Dark", dark: true,
    bg: "#141019", ink: "#f0eaf0", accent: "#e78aa6" },
  { id: "funky", label: "Funky Pink", dark: false,
    bg: "#fff5fa", ink: "#4a1030", accent: "#e0218a" },
  { id: "paper", label: "Paper", dark: false,
    bg: "#faf6ec", ink: "#2e2920", accent: "#9c5c24" },
  { id: "basalt", label: "Basalt", dark: true,
    bg: "#181b1e", ink: "#e6ebf0", accent: "#7aa4c4" },
  { id: "amber", label: "Amber CRT", dark: true,
    bg: "#151008", ink: "#f4e3c2", accent: "#f0a830" },
  { id: "chromacore", label: "Chromacore", dark: true,
    bg: "#090f0c", ink: "#d2e8dc", accent: "#2fd27a" },
];

export interface ThemeTokens {
  id: string;
  dark: boolean;
  base: string; raised: string; surface: string;
  text: string; textDim: string; muted: string;
  hairline: string; hairlineStrong: string;
  acting: string; actingRgb: [number, number, number];
  onActing: string; title: string;
  numerics: string; numericsRgb: [number, number, number];
  inkRgb: [number, number, number];
  add: string; remove: string;
  stone: string; stoneHi: string; stoneLo: string;
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement)
    .getPropertyValue(name).trim();
}

function parseRgbTriple(v: string, fallback: [number, number, number]):
    [number, number, number] {
  const parts = v.split(",").map((s) => parseInt(s.trim(), 10));
  if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
    return parts as [number, number, number];
  }
  return fallback;
}

function readTheme(): ThemeTokens {
  const id = document.documentElement.dataset.theme || "blossom_dark";
  const meta = THEMES.find((t) => t.id === id) ?? THEMES[0];
  return {
    id: meta.id,
    dark: meta.dark,
    base: cssVar("--ink-base"),
    raised: cssVar("--ink-raised"),
    surface: cssVar("--ink-surface"),
    text: cssVar("--ink-text"),
    textDim: cssVar("--ink-text-dim"),
    muted: cssVar("--ink-muted"),
    hairline: cssVar("--ink-hairline"),
    hairlineStrong: cssVar("--hairline-strong"),
    acting: cssVar("--acting"),
    actingRgb: parseRgbTriple(cssVar("--acting-rgb"), [236, 143, 172]),
    onActing: cssVar("--on-acting"),
    title: cssVar("--title"),
    numerics: cssVar("--numerics"),
    numericsRgb: hexToRgb(cssVar("--numerics"), [232, 200, 126]),
    inkRgb: parseRgbTriple(cssVar("--ink-rgb"), [245, 234, 239]),
    add: cssVar("--signal-add"),
    remove: cssVar("--signal-remove"),
    stone: cssVar("--stone"),
    stoneHi: cssVar("--stone-hi"),
    stoneLo: cssVar("--stone-lo"),
  };
}

function hexToRgb(hex: string, fallback: [number, number, number]):
    [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** rgba() string from a channel triple. */
export function rgba(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export let theme: ThemeTokens = null as any; // populated by applyTheme at boot

/** Stamp a palette row on the document, mirror it here, tell listeners.
    Canvas layers (field, garden, FFT) subscribe to "theme". */
export function applyTheme(id: string): void {
  if (!THEMES.some((t) => t.id === id)) id = "blossom_dark";
  document.documentElement.dataset.theme = id;
  try { localStorage.setItem("eyeTheme", id); } catch { /* private mode */ }
  theme = readTheme();
  store.emit("theme");
}

/** Boot-time read (theme was already stamped pre-paint by index.html). */
export function initTheme(): void {
  theme = readTheme();
}

export const CAT_HUES: Record<string, [number, number]> = {
  // hue, base saturation — low chroma per PART 2; 4 canonical + live extras
  user_pref: [338, 45],
  project: [205, 30],
  tool: [0, 0],
  general: [0, 0],
  lesson: [140, 15],
  seed: [30, 25],
  session: [270, 15],
};

const FALLBACK_HUES: [number, number][] = [
  [180, 20], [60, 20], [300, 18], [110, 18],
];

/** Category color, trust-saturated, tuned per light/dark room:
    on dark grounds trust brightens the dot; on light grounds trust
    deepens it — vivid always means trusted. */
export function catColor(category: string, trust: number, alpha = 1): string {
  let hs = CAT_HUES[category];
  if (!hs) {
    let h = 0;
    for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) % FALLBACK_HUES.length;
    hs = FALLBACK_HUES[h];
  }
  const [hue, baseSat] = hs;
  const dark = theme?.dark ?? true;
  const sat = baseSat * (0.4 + trust * 0.6) / 0.7 * (dark ? 1 : 1.25);
  const lit = dark
    ? (category === "tool" ? 72 * (0.55 + trust * 0.5)
       : category === "general" ? 50 * (0.6 + trust * 0.6)
       : 38 + trust * 34)
    : (category === "tool" ? 52 - trust * 22
       : category === "general" ? 55 - trust * 25
       : 62 - trust * 28);
  return `hsla(${hue}, ${sat}%, ${dark ? Math.min(lit, 80) : Math.max(lit, 22)}%, ${alpha})`;
}

export function fid(id: number): string {
  return `f#${String(id).padStart(4, "0")}`;
}
