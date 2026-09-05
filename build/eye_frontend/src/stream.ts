/* Stream footer — every memory op as it lands (PART 6 §5).
   Fed by the journal over WS; backfilled from journal.tail.
   GPLv3 — see LICENSE. */

import { store, EyeEvent, fid } from "./state";

function parse(s: string | null): Record<string, any> {
  if (!s) return {};
  try {
    const value = JSON.parse(s);
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value : {};
  } catch { return {}; }
}

function shortContent(s: unknown, n = 60): string {
  const text = typeof s === "string" ? s : String(s ?? "");
  return `“${text.slice(0, n)}${text.length > n ? "…" : ""}”`;
}

function asFactId(v: unknown): number | null {
  return typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
}

function resultItems(resp: any): any[] {
  if (Array.isArray(resp?.results)) return resp.results;
  if (Array.isArray(resp?.facts)) return resp.facts;
  return [];
}

function resultCount(resp: any): string {
  const n = resultItems(resp).filter((r: any) => asFactId(r?.fact_id) !== null).length;
  return `${n} result${n === 1 ? "" : "s"}`;
}

/** Fact navigation uses explicit fields from the journal schemas only.
    It never walks arbitrary objects, so entity_id and event_id cannot be
    mistaken for facts. Invalid and non-integer IDs are ignored. */
export function eventFactIds(ev: EyeEvent): number[] {
  const req = parse(ev.request);
  const resp = parse(ev.response);
  const before = parse(ev.before);
  const after = parse(ev.after);
  const ids: number[] = [];
  const add = (v: unknown) => {
    const id = asFactId(v);
    if (id !== null && !ids.includes(id)) ids.push(id);
  };
  const addRows = (rows: unknown) => {
    if (!Array.isArray(rows)) return;
    for (const row of rows) {
      if (row && typeof row === "object") add((row as any).fact_id);
    }
  };
  const addFlat = (values: unknown) => {
    if (Array.isArray(values)) for (const value of values) add(value);
  };

  if (ev.source === "prefetch") {
    addFlat(resp.fact_ids);
    return ids;
  }
  if (ev.source === "mirror" || ev.source === "auto_extract" || ev.source === "undo") {
    addRows(before.facts);
    addRows(after.facts);
    return ids;
  }
  if (ev.source === "tool") {
    if (["search", "probe", "related", "reason"].includes(ev.kind)) {
      addRows(resp.results);
    } else if (ev.kind === "list") {
      addRows(resp.facts);
    } else if (ev.kind === "add") {
      add(resp.fact_id);
      addRows(after.facts);
    } else if (["update", "remove", "helpful", "unhelpful"].includes(ev.kind)) {
      add(req.fact_id);
      add(resp.fact_id);
      addRows(before.facts);
      addRows(after.facts);
    }
    return ids;
  }
  if (ev.source === "eye") {
    if (ev.kind === "fact.add") {
      add(resp.fact_id);
      addRows(after.facts);
    } else if (["fact.update", "fact.remove", "fact.trust_set", "helpful", "unhelpful"].includes(ev.kind)) {
      add(req.fact_id);
      add(resp.fact_id);
      addRows(before.facts);
      addRows(after.facts);
    } else if (ev.kind === "backfill_vectors") {
      addRows(before.facts);
      addRows(after.facts);
    }
  }
  return ids;
}

export function describe(ev: EyeEvent): { action: string; detail: string; cls: string } {
  const req = parse(ev.request), resp = parse(ev.response);
  const src = String(ev.source ?? ""), k = String(ev.kind ?? "");
  if (src === "prefetch") {
    const ids = Array.isArray(resp.fact_ids) ? resp.fact_ids.map(asFactId).filter((x: number | null): x is number => x !== null) : [];
    return { action: "prefetch", cls: "src-prefetch",
             detail: `${shortContent(req.query ?? "", 44)} → injected ${ids.length} facts, ${Number(resp.chars) || 0} chars` };
  }
  if (src === "mirror")
    return { action: "mirror", cls: "src-mirror",
             detail: `memory ${k} → ${shortContent(req.content ?? "", 50)}${afterIds(ev)}` };
  if (src === "auto_extract")
    return { action: "auto_extract", cls: "src-mirror",
             detail: `session end → ${Number(resp.facts_extracted) || 0} facts extracted${afterIds(ev)}` };
  if (src === "session")
    return { action: k, cls: "src-mirror",
             detail: k === "initialize"
               ? `${String(req.platform || "?")} · mode ${String(req.mode || "journal")}`
               : (k === "session_switch" ? `→ ${String(req.to || "")}` : "") };
  if (src === "undo")
    return { action: "undo", cls: "src-eye",
             detail: `event #${String(req.event_id ?? "?")} (${String(req.undone_source ?? "")}/${String(req.undone_kind ?? "")}) reverted` };
  if (src === "eye")
    return { action: k, cls: "src-eye", detail: eyeDetail(k, req, resp) };
  switch (k) {
    case "add": return { action: "fact_store(add)", cls: "",
      detail: `${shortContent(req.content ?? "")} → ${factLabel(resp.fact_id)}${entPlus(ev)}` };
    case "search": return { action: "fact_store(search)", cls: "",
      detail: `${shortContent(req.query ?? "", 40)} → ${resultCount(resp)}` };
    case "probe": return { action: "fact_store(probe)", cls: "",
      detail: `“${String(req.entity ?? "")}” → ${resultCount(resp)}` };
    case "related": return { action: "fact_store(related)", cls: "",
      detail: `“${String(req.entity ?? "")}” → ${resultCount(resp)}` };
    case "reason": return { action: "fact_store(reason)", cls: "",
      detail: `${(Array.isArray(req.entities) ? req.entities : []).map(String).join(", ")} → ${resultCount(resp)}` };
    case "contradict": return { action: "fact_store(contradict)", cls: "",
      detail: `${Number(resp.count) || 0} candidate pair(s)` };
    case "update": return { action: "fact_store(update)", cls: "",
      detail: `${factLabel(req.fact_id)}${req.content ? " content" : ""}${req.trust_delta !== undefined ? ` trust${Number(req.trust_delta) > 0 ? "+" : ""}${String(req.trust_delta)}` : ""}${req.category ? ` cat=${String(req.category)}` : ""}` };
    case "remove": return { action: "fact_store(remove)", cls: "",
      detail: factLabel(req.fact_id) };
    case "list": return { action: "fact_store(list)", cls: "",
      detail: `${Number(resp.count) || 0} facts · ${resultCount(resp)}` };
    case "helpful": case "unhelpful":
      return { action: `fact_feedback(${k})`, cls: "",
        detail: `${factLabel(req.fact_id)} trust ${num(resp.old_trust)} → ${num(resp.new_trust)}` };
    default: return { action: `${src}/${k}`, cls: "", detail: "" };
  }
}

function factLabel(v: unknown): string {
  const id = asFactId(v);
  return id === null ? "fact ?" : fid(id);
}

function num(v: any): string { return v === undefined ? "?" : Number(v).toFixed(2); }

function entPlus(ev: EyeEvent): string {
  const after = parse(ev.after);
  const n = Array.isArray(after.entities_created) ? after.entities_created.length : 0;
  return n ? ` · entity+${n}` : "";
}

function afterIds(ev: EyeEvent): string {
  const after = parse(ev.after);
  const facts = Array.isArray(after.facts)
    ? after.facts.filter((f: any) => asFactId(f?.fact_id) !== null) : [];
  return facts.length ? ` · ${facts.length} fact${facts.length === 1 ? "" : "s"}` : "";
}

function eyeDetail(k: string, req: any, resp: any): string {
  switch (k) {
    case "fact.add": return `${shortContent(req.content ?? "")} → ${factLabel(resp.fact_id)}`;
    case "fact.update": return `${factLabel(req.fact_id)} edited`;
    case "fact.remove": return `${factLabel(req.fact_id)} deleted`;
    case "fact.trust_set": return `${factLabel(req.fact_id)} trust ${num(resp.old_trust)} → ${num(resp.new_trust)}`;
    case "helpful": case "unhelpful": return `${factLabel(req.fact_id)} trust → ${num(resp?.new_trust)}`;
    case "entity.merge": return `“${String(resp.merged ?? "")}” ⇒ “${String(resp.into ?? "")}” (${Number(resp.facts_relinked) || 0} facts)`;
    case "entity.alias": return `entity #${String(req.entity_id ?? "?")} updated`;
    case "entity.remove": return `“${String(resp.removed ?? "")}” removed (${Number(resp.facts_unlinked) || 0} unlinked)`;
    case "backfill_vectors": return `${Number(resp.backfilled) || 0} vector(s) re-encoded`;
    case "backup": return `→ ${String(resp.path ?? "")}`;
    default: return "";
  }
}

interface RenderedLine { el: HTMLElement; signature: string; }

export class Stream {
  private el: HTMLElement;
  private rendered = new Map<number, RenderedLine>();
  private renderPending = false;

  constructor(el: HTMLElement) {
    this.el = el;
    store.on("events", () => this.scheduleRender());
    this.el.addEventListener("click", (e) => this.navigate(e));
    this.el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") this.navigate(e);
    });
    setInterval(() => this.age(), 5000);
  }

  private scheduleRender(): void {
    if (this.renderPending) return;
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.renderPending = false;
      this.render();
    });
  }

  private navigate(e: Event): void {
    const target = e.target as HTMLElement;
    const ref = target.closest<HTMLElement>(".s-fid[data-fid]");
    if (ref) {
      const id = Number(ref.dataset.fid);
      if (store.facts.has(id)) store.select([id]);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const line = target.closest<HTMLElement>(".s-line[data-fids]");
    if (!line) return;
    const ids = (line.dataset.fids || "").split(",").map(Number)
      .filter((id) => Number.isSafeInteger(id) && store.facts.has(id));
    if (ids.length) store.select(ids);
  }

  private render(): void {
    const atBottom = this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 30;
    const events = store.events.slice(-200);
    const wanted = new Set(events.map((ev) => ev.event_id));

    // Anchor the first still-retained visible row. Removing old history at
    // the top must not move the user's reading position.
    let anchorId: number | null = null;
    let anchorOffset = 0;
    if (!atBottom) {
      for (const child of Array.from(this.el.children) as HTMLElement[]) {
        const id = Number(child.dataset.eid);
        if (wanted.has(id) && child.offsetTop + child.offsetHeight >= this.el.scrollTop) {
          anchorId = id;
          anchorOffset = child.offsetTop - this.el.scrollTop;
          break;
        }
      }
    }

    for (const [id, line] of this.rendered) {
      if (!wanted.has(id)) {
        line.el.remove();
        this.rendered.delete(id);
      }
    }

    const existingIds = Array.from(this.el.children).map((child) =>
      Number((child as HTMLElement).dataset.eid));
    const appendOnly = existingIds.every((id, index) => events[index]?.event_id === id);
    const fragment = document.createDocumentFragment();
    for (const ev of events) {
      const signature = JSON.stringify([
        ev.ts, ev.source, ev.kind, ev.request, ev.response,
        ev.before, ev.after, ev.duration_ms, ev.undone_by,
      ]);
      const current = this.rendered.get(ev.event_id);
      if (!current) {
        const el = this.makeLine(ev);
        this.rendered.set(ev.event_id, { el, signature });
        fragment.appendChild(el);
      } else if (current.signature !== signature) {
        const el = this.makeLine(ev);
        current.el.replaceWith(el);
        this.rendered.set(ev.event_id, { el, signature });
      }
    }
    if (appendOnly) {
      this.el.appendChild(fragment);
    } else {
      // A reconnect backfill can insert missed older IDs. Reorder only on
      // that rare path; the usual live append moves no retained nodes.
      const ordered = document.createDocumentFragment();
      for (const ev of events) {
        const line = this.rendered.get(ev.event_id)?.el;
        if (line) ordered.appendChild(line);
      }
      this.el.appendChild(ordered);
    }
    this.age();

    if (atBottom) {
      this.el.scrollTop = this.el.scrollHeight;
    } else if (anchorId !== null) {
      const anchor = this.rendered.get(anchorId)?.el;
      if (anchor) this.el.scrollTop = anchor.offsetTop - anchorOffset;
    }
  }

  private makeLine(ev: EyeEvent): HTMLElement {
    const d = describe(ev);
    const line = document.createElement("div");
    line.className = `s-line${ev.undone_by ? " undone" : ""}`;
    line.dataset.age = ev.ts;
    line.dataset.eid = String(ev.event_id);
    const ids = eventFactIds(ev);
    line.dataset.fids = ids.join(",");
    const scoreById = new Map<number, number>();
    for (const item of resultItems(parse(ev.response))) {
      const id = asFactId(item?.fact_id);
      const score = Number(item?.score);
      if (id !== null && Number.isFinite(score) && !scoreById.has(id)) scoreById.set(id, score);
    }

    const time = document.createElement("span");
    time.className = "s-time";
    time.textContent = new Date(ev.ts).toLocaleTimeString("en-GB");
    line.appendChild(time);

    const action = document.createElement("span");
    action.className = `s-act ${d.cls}`;
    action.textContent = d.action;
    line.appendChild(action);

    const detail = document.createElement("span");
    detail.className = "s-det";
    detail.textContent = d.detail;
    if (ids.length) {
      detail.appendChild(document.createTextNode(" · "));
      ids.forEach((id, index) => {
        if (index) detail.appendChild(document.createTextNode(" "));
        const ref = document.createElement("b");
        ref.className = "s-fid";
        ref.dataset.fid = String(id);
        ref.tabIndex = 0;
        ref.setAttribute("role", "button");
        const score = scoreById.get(id);
        ref.textContent = fid(id);
        if (score !== undefined) ref.title = `score ${score.toFixed(2)}`;
        detail.appendChild(ref);
      });
    }
    line.appendChild(detail);

    const ok = document.createElement("span");
    const err = ev.response?.includes('"error"') ?? false;
    ok.className = err ? "s-err" : "s-ok";
    ok.textContent = err ? "✗" : "✓";
    line.appendChild(ok);

    const duration = document.createElement("span");
    duration.className = "s-ms";
    duration.textContent = ev.duration_ms != null ? `${Math.round(ev.duration_ms)}ms` : "";
    line.appendChild(duration);
    return line;
  }

  private age(): void {
    const now = Date.now();
    this.el.querySelectorAll<HTMLElement>(".s-line").forEach((line) => {
      const age = (now - new Date(line.dataset.age!).getTime()) / 1000;
      const o = age < 30 ? 1 - (age / 30) * 0.45 : age < 300 ? 0.55 : 0.45;
      line.style.opacity = String(o);
    });
  }
}
