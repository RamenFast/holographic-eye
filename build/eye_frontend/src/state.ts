/* Central state + pub/sub for the Eye. GPLv3 — see LICENSE. */

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

  selection = new Set<number>();     // selected fact_ids
  focusedFact: number | null = null; // the fact in the Inspect pane
  entityHighlight = new Set<number>();  // fact_ids highlighted via entity probe
  highlightEntity: string | null = null;
  // trust lens: view facts above/below a draggable threshold (feedback #4)
  trustLens: { mode: "off" | "above" | "below"; value: number } =
    { mode: "off", value: 0.5 };
  probedRecently = new Map<string, number>(); // entity name (lower) → ts ms
  reasonHalo: { entities: string[]; factIds: Set<number> } | null = null;

  private listeners = new Map<string, Set<Listener>>();

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

  pushEvent(ev: EyeEvent): void {
    this.events.push(ev);
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
    // track "probed recently" entity state for the Entities pane monograms
    try {
      const req = ev.request ? JSON.parse(ev.request) : {};
      const names: string[] = [];
      if (req.entity) names.push(String(req.entity));
      if (Array.isArray(req.entities)) names.push(...req.entities.map(String));
      for (const n of names) this.probedRecently.set(n.toLowerCase(), Date.now());
    } catch { /* not JSON */ }
    this.emit("events");
  }

  select(ids: number[], mode: "set" | "add" = "set"): void {
    if (mode === "set") this.selection.clear();
    for (const id of ids) this.selection.add(id);
    this.focusedFact = ids.length ? ids[ids.length - 1] : null;
    this.emit("selection");
  }

  clearSelection(): void {
    this.selection.clear();
    this.focusedFact = null;
    this.emit("selection");
  }
}

export const store = new Store();

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

export function catColor(category: string, trust: number, alpha = 1): string {
  let hs = CAT_HUES[category];
  if (!hs) {
    let h = 0;
    for (const ch of category) h = (h * 31 + ch.charCodeAt(0)) % FALLBACK_HUES.length;
    hs = FALLBACK_HUES[h];
  }
  const [hue, baseSat] = hs;
  const sat = baseSat * (0.4 + trust * 0.6) / 0.7;
  const lit = category === "tool" ? 72 * (0.55 + trust * 0.5)
            : category === "general" ? 50 * (0.6 + trust * 0.6)
            : 38 + trust * 34;
  return `hsla(${hue}, ${sat}%, ${Math.min(lit, 80)}%, ${alpha})`;
}

export function fid(id: number): string {
  return `f#${String(id).padStart(4, "0")}`;
}
