/* Stream footer — every memory op as it lands (PART 6 §5).
   Fed by the journal over WS; backfilled from journal.tail.
   GPLv3 — see LICENSE. */

import { store, EyeEvent, fid } from "./state";
import { escapeHtml } from "./field";

function parse(s: string | null): any {
  if (!s) return {};
  try { return JSON.parse(s); } catch { return {}; }
}

function shortContent(s: string, n = 60): string {
  return `“${s.slice(0, n)}${s.length > n ? "…" : ""}”`;
}

function topIds(resp: any): string {
  const items = resp.results || resp.facts || [];
  return items.slice(0, 3).map((r: any) =>
    `<b>${fid(r.fact_id)}</b>${r.score !== undefined ? ` (${Number(r.score).toFixed(2)})` : ""}`
  ).join(" ");
}

export function describe(ev: EyeEvent): { action: string; detail: string; cls: string } {
  const req = parse(ev.request), resp = parse(ev.response);
  const src = ev.source, k = ev.kind;
  if (src === "prefetch") {
    const ids = (resp.fact_ids || []).map((i: number) => `<b>${fid(i)}</b>`).join(" ");
    return { action: "prefetch", cls: "src-prefetch",
             detail: `${shortContent(req.query ?? "", 44)} → injected ${resp.fact_ids?.length ?? 0} facts, ${resp.chars ?? 0} chars ${ids}` };
  }
  if (src === "mirror")
    return { action: "mirror", cls: "src-mirror",
             detail: `memory ${k} → ${shortContent(req.content ?? "", 50)}${afterIds(ev)}` };
  if (src === "auto_extract")
    return { action: "auto_extract", cls: "src-mirror",
             detail: `session end → ${resp.facts_extracted ?? 0} facts extracted${afterIds(ev)}` };
  if (src === "session")
    return { action: k, cls: "src-mirror",
             detail: k === "initialize"
               ? `${req.platform || "?"} · mode ${req.mode || "journal"}`
               : (k === "session_switch" ? `→ ${req.to || ""}` : "") };
  if (src === "undo")
    return { action: "undo", cls: "src-eye",
             detail: `event #${req.event_id} (${req.undone_source}/${req.undone_kind}) reverted` };
  if (src === "eye")
    return { action: k, cls: "src-eye", detail: eyeDetail(k, req, resp) };
  // source = tool
  switch (k) {
    case "add": return { action: "fact_store(add)", cls: "",
      detail: `${shortContent(req.content ?? "")} → <b>${fid(resp.fact_id ?? 0)}</b>${entPlus(ev)}` };
    case "search": return { action: "fact_store(search)", cls: "",
      detail: `${shortContent(req.query ?? "", 40)} → ${topIds(resp)}` };
    case "probe": return { action: "fact_store(probe)", cls: "",
      detail: `“${escapeHtml(req.entity ?? "")}” → ${topIds(resp)}` };
    case "related": return { action: "fact_store(related)", cls: "",
      detail: `“${escapeHtml(req.entity ?? "")}” → ${topIds(resp)}` };
    case "reason": return { action: "fact_store(reason)", cls: "",
      detail: `${(req.entities || []).map(escapeHtml).join(", ")} → ${topIds(resp)}` };
    case "contradict": return { action: "fact_store(contradict)", cls: "",
      detail: `${resp.count ?? 0} candidate pair(s)` };
    case "update": return { action: "fact_store(update)", cls: "",
      detail: `${fid(req.fact_id ?? 0)}${req.content ? " content" : ""}${req.trust_delta !== undefined ? ` trust${req.trust_delta > 0 ? "+" : ""}${req.trust_delta}` : ""}${req.category ? ` cat=${req.category}` : ""}` };
    case "remove": return { action: "fact_store(remove)", cls: "",
      detail: fid(req.fact_id ?? 0) };
    case "list": return { action: "fact_store(list)", cls: "",
      detail: `${resp.count ?? 0} facts` };
    case "helpful": case "unhelpful":
      return { action: `fact_feedback(${k})`, cls: "",
        detail: `${fid(req.fact_id ?? 0)} trust ${num(resp.old_trust)} → <b>${num(resp.new_trust)}</b>` };
    default: return { action: `${src}/${k}`, cls: "", detail: "" };
  }
}

function num(v: any): string { return v === undefined ? "?" : Number(v).toFixed(2); }

function entPlus(ev: EyeEvent): string {
  const after = parse(ev.after);
  const n = (after.entities_created || []).length;
  return n ? ` · entity+${n}` : "";
}

function afterIds(ev: EyeEvent): string {
  const after = parse(ev.after);
  const facts = after.facts || [];
  return facts.length ? " · " + facts.map((f: any) => `<b>${fid(f.fact_id)}</b>`).join(" ") : "";
}

function eyeDetail(k: string, req: any, resp: any): string {
  switch (k) {
    case "fact.add": return `${shortContent(req.content ?? "")} → <b>${fid(resp.fact_id ?? 0)}</b>`;
    case "fact.update": return `${fid(req.fact_id ?? 0)} edited`;
    case "fact.remove": return `${fid(req.fact_id ?? 0)} deleted`;
    case "fact.trust_set": return `${fid(req.fact_id ?? 0)} trust ${num(resp.old_trust)} → <b>${num(resp.new_trust)}</b>`;
    case "helpful": case "unhelpful": return `${fid(req.fact_id ?? 0)} trust → <b>${num(resp?.new_trust)}</b>`;
    case "entity.merge": return `“${escapeHtml(resp.merged ?? "")}” ⇒ “${escapeHtml(resp.into ?? "")}” (${resp.facts_relinked ?? 0} facts)`;
    case "entity.alias": return `entity #${req.entity_id} updated`;
    case "entity.remove": return `“${escapeHtml(resp.removed ?? "")}” removed (${resp.facts_unlinked ?? 0} unlinked)`;
    case "backfill_vectors": return `${resp.backfilled ?? 0} vector(s) re-encoded`;
    case "backup": return `→ ${escapeHtml(resp.path ?? "")}`;
    default: return "";
  }
}

export class Stream {
  private el: HTMLElement;
  constructor(el: HTMLElement) {
    this.el = el;
    store.on("events", () => this.render());
    setInterval(() => this.age(), 5000);
  }

  private render(): void {
    const atBottom = this.el.scrollTop + this.el.clientHeight >= this.el.scrollHeight - 30;
    const events = store.events.slice(-200);
    this.el.innerHTML = events.map((ev) => {
      const d = describe(ev);
      const t = new Date(ev.ts).toLocaleTimeString("en-GB");
      const err = ev.response?.includes('"error"');
      const ms = ev.duration_ms != null ? `${Math.round(ev.duration_ms)}ms` : "";
      const undone = ev.undone_by ? " undone" : "";
      return `<div class="s-line${undone}" data-age="${ev.ts}" data-eid="${ev.event_id}">` +
        `<span class="s-time">${t}</span>` +
        `<span class="s-act ${d.cls}">${d.action}</span>` +
        `<span class="s-det">${d.detail}</span>` +
        `<span class="${err ? "s-err" : "s-ok"}">${err ? "✗" : "✓"}</span>` +
        `<span class="s-ms">${ms}</span></div>`;
    }).join("");
    this.age();
    if (atBottom) this.el.scrollTop = this.el.scrollHeight;
    // click a mutation line → select its fact
    this.el.querySelectorAll<HTMLElement>(".s-line").forEach((line) => {
      line.onclick = () => {
        const ev = store.events.find((e) => e.event_id === Number(line.dataset.eid));
        if (!ev) return;
        const req = parse(ev.request), resp = parse(ev.response);
        const id = resp.fact_id ?? req.fact_id;
        if (id && store.facts.has(Number(id))) store.select([Number(id)]);
      };
    });
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
