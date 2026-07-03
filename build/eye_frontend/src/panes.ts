/* Left column (Entities / Queue / Contradict tabs) and the Inspect pane.
   PART 6 §2, §4 + adaptation deltas (queue/contradictions, undo).
   GPLv3 — see LICENSE. */

import { rpc, toolRead } from "./api";
import { store, fid, EyeEvent, CAT_HUES } from "./state";
import { escapeHtml } from "./field";
import { openWorkbench, openFft, openEditPreview, openDeleteModal } from "./modals";

const MUTATION_KINDS = new Set([
  "add", "update", "remove", "helpful", "unhelpful", "extract",
  "fact.add", "fact.update", "fact.remove", "fact.trust_set",
  "entity.merge", "entity.alias", "entity.remove", "backfill_vectors", "undo",
]);

function h(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

// ---------------------------------------------------------------------------
// Left column
// ---------------------------------------------------------------------------

export class LeftColumn {
  private el: HTMLElement;
  private tab: "entities" | "queue" | "contra" = "entities";
  private entityFilter = "";
  private expanded = false;
  private contraData: any[] | null = null;
  private lastReviewed = Number(localStorage.getItem("eyeLastReviewed") || 0);

  constructor(el: HTMLElement) {
    this.el = el;
    store.on("entities", () => this.render());
    store.on("events", () => this.render());
    this.render();
    setInterval(() => { if (this.tab === "entities") this.render(); }, 15000);
  }

  private setTab(t: "entities" | "queue" | "contra"): void {
    this.tab = t;
    if (t === "queue") {
      this.lastReviewed = Date.now();
      localStorage.setItem("eyeLastReviewed", String(this.lastReviewed));
    }
    if (t === "contra" && this.contraData === null) this.loadContra();
    this.render();
  }

  private async loadContra(): Promise<void> {
    this.contraData = [];
    try {
      const res = await toolRead("contradict", { limit: 10 });
      this.contraData = res.results || [];
    } catch { /* leave empty */ }
    this.render();
  }

  private queueEvents(): EyeEvent[] {
    return store.events.filter((e) =>
      MUTATION_KINDS.has(e.kind) &&
      ["tool", "mirror", "auto_extract", "eye", "undo"].includes(e.source)
    ).slice(-80).reverse();
  }

  render(): void {
    const badge = this.queueEvents()
      .filter((e) => new Date(e.ts).getTime() > this.lastReviewed && !e.undone_by).length;
    let body = "";
    if (this.tab === "entities") body = this.renderEntities();
    else if (this.tab === "queue") body = this.renderQueue();
    else body = this.renderContra();

    this.el.innerHTML = `
      <div class="tabs">
        <div class="tab ${this.tab === "entities" ? "active" : ""}" data-t="entities">ENTITIES</div>
        <div class="tab ${this.tab === "queue" ? "active" : ""}" data-t="queue">QUEUE${badge ? ` <span class="badge">${badge}</span>` : ""}</div>
        <div class="tab ${this.tab === "contra" ? "active" : ""}" data-t="contra">CONTRA</div>
      </div>${body}`;

    this.el.querySelectorAll<HTMLElement>(".tab").forEach((tabEl) => {
      tabEl.onclick = () => this.setTab(tabEl.dataset.t as any);
    });
    this.bind();
  }

  private renderEntities(): string {
    const filter = this.entityFilter.toLowerCase();
    let rows = store.entities;
    if (filter) rows = rows.filter((e) =>
      e.name.toLowerCase().includes(filter) || e.aliases.toLowerCase().includes(filter));
    const shown = this.expanded ? rows : rows.slice(0, 40);
    const now = Date.now();
    const items = shown.map((e) => {
      const probed = (store.probedRecently.get(e.name.toLowerCase()) ?? 0) > now - 60000;
      const glyph = e.fact_count === 0
        ? '<span class="mono-state st-empty" title="zero facts linked">⊗</span>'
        : probed
          ? '<span class="mono-state st-probed" title="probed in the last 60s">⊙</span>'
          : '<span class="mono-state st-idle">○</span>';
      const active = store.highlightEntity === e.name ? " active" : "";
      return `<div class="ent-row${active}" data-name="${escapeHtml(e.name)}" data-id="${e.entity_id}">
        <span class="chev">▸</span><span class="nm">${escapeHtml(e.name)}</span>
        <span class="n">${e.fact_count}</span>${glyph}</div>`;
    }).join("");
    return `
      <div class="pane-sub"><input id="entfilter" placeholder="filter ${store.entityTotal} entities…"
        value="${escapeHtml(this.entityFilter)}"></div>
      <div class="ent-list">${items}</div>
      ${rows.length > 40 && !this.expanded
        ? `<div class="more" id="entmore">+ ${rows.length - 40} more</div>` : ""}
      <div class="pane-hint">click: highlight via probe · ⌘click: reason · right-click: desk</div>`;
  }

  private renderQueue(): string {
    const items = this.queueEvents().map((ev) => {
      const req = ev.request ? JSON.parse(ev.request) : {};
      const resp = ev.response ? safeParse(ev.response) : {};
      const t = new Date(ev.ts).toLocaleTimeString("en-GB");
      const label = `${ev.source === "tool" ? "agent" : ev.source}·${ev.kind}`;
      const target = resp.fact_id ?? req.fact_id ?? "";
      const undone = ev.undone_by ? `<span class="q-undone">undone</span>` :
        (ev.source !== "undo"
          ? `<button class="btn undo q-undo" data-eid="${ev.event_id}">↶ undo</button>` : "");
      return `<div class="q-row ${ev.undone_by ? "was-undone" : ""}" data-fid="${target}">
        <div class="q-head"><span class="s-time">${t}</span>
          <span class="q-kind">${label}</span>${target ? `<span class="q-fid">${fid(Number(target))}</span>` : ""}</div>
        <div class="q-body">${queueSummary(ev, req, resp)}</div>
        <div class="q-actions">${undone}</div></div>`;
    }).join("");
    return `<div class="q-list">${items ||
      '<div class="pane-hint">no journaled mutations yet — the queue fills as the agent writes</div>'}</div>`;
  }

  private renderContra(): string {
    if (this.contraData === null) return `<div class="pane-hint">scanning…</div>`;
    if (!this.contraData.length)
      return `<div class="pane-hint">no contradiction candidates above threshold — memory is coherent (or quiet)</div>`;
    return `<div class="q-list">` + this.contraData.map((c) => `
      <div class="c-row" data-a="${c.fact_a.fact_id}" data-b="${c.fact_b.fact_id}">
        <div class="q-head"><span class="q-kind">score ${c.contradiction_score}</span>
          <span class="q-fid">${fid(c.fact_a.fact_id)} ⇄ ${fid(c.fact_b.fact_id)}</span></div>
        <div class="q-body">“${escapeHtml(c.fact_a.content.slice(0, 70))}…”<br>
          “${escapeHtml(c.fact_b.content.slice(0, 70))}…”</div>
        <div class="q-body dim">shared: ${c.shared_entities.map(escapeHtml).join(", ")}</div>
      </div>`).join("") + `</div>
      <div class="pane-hint" id="contra-refresh">↻ re-scan</div>`;
  }

  private bind(): void {
    const filterEl = this.el.querySelector<HTMLInputElement>("#entfilter");
    if (filterEl) {
      filterEl.oninput = () => {
        this.entityFilter = filterEl.value;
        const list = this.el.querySelector(".ent-list");
        if (list) {
          // re-render but keep input focus
          const pos = filterEl.selectionStart ?? filterEl.value.length;
          this.render();
          const again = this.el.querySelector<HTMLInputElement>("#entfilter")!;
          again.focus(); again.setSelectionRange(pos, pos);
        }
      };
    }
    this.el.querySelector<HTMLElement>("#entmore")?.addEventListener("click", () => {
      this.expanded = true; this.render();
    });
    this.el.querySelector<HTMLElement>("#contra-refresh")?.addEventListener("click", () => {
      this.contraData = null; this.render(); this.loadContra();
    });
    this.el.querySelectorAll<HTMLElement>(".ent-row").forEach((row) => {
      const name = row.dataset.name!;
      row.onclick = (e) => {
        if (e.metaKey || e.ctrlKey) {
          openWorkbench([...new Set([...(store.reasonHalo?.entities ?? []), name])]);
        } else {
          highlightEntity(name);
        }
      };
      row.oncontextmenu = (e) => {
        e.preventDefault();
        entityMenu(e as MouseEvent, Number(row.dataset.id!), name);
      };
    });
    this.el.querySelectorAll<HTMLElement>(".q-undo").forEach((btn) => {
      btn.onclick = async (e) => {
        e.stopPropagation();
        btn.textContent = "…";
        try {
          await rpc("undo", { event_id: Number(btn.dataset.eid) });
          (window as any).eyeRefresh();
        } catch (err: any) { alert(err.message); this.render(); }
      };
    });
    this.el.querySelectorAll<HTMLElement>(".q-row").forEach((row) => {
      row.onclick = () => {
        const idNum = Number(row.dataset.fid);
        if (idNum && store.facts.has(idNum)) store.select([idNum]);
      };
    });
    this.el.querySelectorAll<HTMLElement>(".c-row").forEach((row) => {
      row.onclick = () => {
        const a = Number(row.dataset.a), b = Number(row.dataset.b);
        store.select([a, b].filter((x) => store.facts.has(x)));
      };
    });
  }
}

function safeParse(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}

function queueSummary(ev: EyeEvent, req: any, resp: any): string {
  const before = ev.before ? safeParse(ev.before) : {};
  const bf = (before.facts || [])[0];
  switch (ev.kind) {
    case "add": case "fact.add":
      return `“${escapeHtml((req.content || "").slice(0, 90))}”`;
    case "update": case "fact.update":
      return bf ? `was: “${escapeHtml(bf.content.slice(0, 80))}”` : "edited";
    case "remove": case "fact.remove":
      return bf ? `deleted: “${escapeHtml(bf.content.slice(0, 80))}”` : "deleted";
    case "helpful": case "unhelpful":
      return `trust ${bf ? bf.trust_score.toFixed(2) : "?"} → ${resp.new_trust !== undefined ? Number(resp.new_trust).toFixed(2) : "?"}`;
    case "extract":
      return `${resp.facts_extracted ?? 0} facts auto-extracted at session end`;
    default: {
      const d = ev.response ? escapeHtml(String(ev.response).slice(0, 90)) : ev.kind;
      return d;
    }
  }
}

export async function highlightEntity(name: string | null): Promise<void> {
  const field = (window as any).eyeField;
  if (!name || store.highlightEntity === name) {
    store.highlightEntity = null;
    store.entityHighlight.clear();
    field?.logMath([]);
    store.emit("entities");
    return;
  }
  store.highlightEntity = name;
  store.probedRecently.set(name.toLowerCase(), Date.now());
  // 1) facts linked to the entity in the DB — always present, instant
  const linked = new Set<number>();
  for (const f of store.facts.values()) {
    if (f.entities.some((e) => e.toLowerCase() === name.toLowerCase())) {
      linked.add(f.fact_id);
    }
  }
  store.entityHighlight = new Set(linked);
  store.emit("entities");
  // 2) structural presence via the provider's own probe (same code the
  //    agent runs). probe score = (sim+1)/2 · trust → recover sim; a fact
  //    is structurally hot above sim 0.35 (wireframe cut).
  let structural = 0;
  try {
    const res = await toolRead("probe", { entity: name, limit: 80 });
    for (const r of res.results || []) {
      if (r.trust_score > 0 && (2 * r.score / r.trust_score - 1) > 0.35) {
        store.entityHighlight.add(r.fact_id);
        structural++;
      }
    }
  } catch { /* probe unavailable — linked set stands */ }
  field?.logMath([
    `probe("${name.toLowerCase()}") = unbind(fact, bind(atom, ROLE_ENTITY))`,
    `→ ${linked.size} linked fact(s) · ${structural} structurally hot (sim > 0.35)`,
    `dimmed dots don't involve this entity · esc to clear`,
  ]);
  store.emit("entities");
}

function entityMenu(e: MouseEvent, entityId: number, name: string): void {
  document.querySelector(".ctxmenu")?.remove();
  const menu = h(`<div class="ctxmenu" style="left:${e.clientX}px;top:${e.clientY}px">
    <div data-act="filter">filter field to this entity</div>
    <div data-act="rename">rename / merge…</div>
    <div data-act="remove">remove entity</div>
    <div data-act="copy">copy name</div></div>`);
  document.body.appendChild(menu);
  const close = () => menu.remove();
  setTimeout(() => addEventListener("click", close, { once: true }));
  menu.querySelectorAll<HTMLElement>("[data-act]").forEach((item) => {
    item.onclick = async () => {
      close();
      if (item.dataset.act === "filter") highlightEntity(name);
      if (item.dataset.act === "copy") navigator.clipboard.writeText(name);
      if (item.dataset.act === "rename") {
        const target = prompt(
          `Rename "${name}" — or type an existing entity name to MERGE into it:`, name);
        if (!target || target === name) return;
        const existing = store.entities.find(
          (x) => x.name.toLowerCase() === target.toLowerCase());
        try {
          if (existing && existing.entity_id !== entityId) {
            if (!confirm(`Merge "${name}" into "${existing.name}"? (undoable)`)) return;
            await rpc("entity.merge", { src_id: entityId, dst_id: existing.entity_id });
          } else {
            await rpc("entity.alias", { entity_id: entityId, name: target });
          }
          (window as any).eyeRefresh();
        } catch (err: any) { alert(err.message); }
      }
      if (item.dataset.act === "remove") {
        if (!confirm(`Remove entity "${name}" and its links? (undoable)`)) return;
        try {
          await rpc("entity.remove", { entity_id: entityId });
          (window as any).eyeRefresh();
        } catch (err: any) { alert(err.message); }
      }
    };
  });
}

// ---------------------------------------------------------------------------
// Inspect pane
// ---------------------------------------------------------------------------

export class Inspect {
  private el: HTMLElement;
  constructor(el: HTMLElement) {
    this.el = el;
    store.on("selection", () => this.render());
    store.on("facts", () => this.render());
    this.render();
  }

  async render(): Promise<void> {
    const sel = [...store.selection];
    if (sel.length === 0) {
      this.el.innerHTML = `<div class="pane-label">Inspect</div>
        <div class="pane-hint">click a dot — or drag-select a region.<br><br>
        the field is the agent's real HRR geometry; everything you see is in the database.</div>`;
      return;
    }
    if (sel.length > 1) return this.renderMulti(sel);

    const id = sel[0];
    let fact: any;
    try {
      fact = (await rpc("fact.get", { fact_id: id })).fact;
    } catch {
      fact = store.facts.get(id);
    }
    if (!fact) return;
    const catHue = CAT_HUES[fact.category]?.[0] ?? 0;
    const trust = Number(fact.trust_score);
    const local = store.facts.get(id);
    const entChips = (fact.links ?? []).map((l: any) =>
      `<span class="ent-chip" data-name="${escapeHtml(l.name)}">${escapeHtml(l.name)}</span>`).join("") ||
      `<span class="pane-hint">no entities extracted</span>`;

    this.el.innerHTML = `
      <div class="pane-label">Inspect</div>
      <div class="factid">${fid(id)}</div>
      <div class="inspect-body">
        <div class="chips"><span class="chip-cat" style="color:hsl(${catHue},40%,65%)">${escapeHtml(fact.category.toUpperCase())}</span></div>
        <div class="tags">${escapeHtml(fact.tags || "no tags")}</div>
        <div class="content" id="ins-content">${escapeHtml(fact.content)}</div>
        <div class="editlinks">
          <a id="edit-content">edit content</a>
          <a id="edit-category">edit category ▾</a>
          <a id="edit-tags">edit tags</a>
        </div>
        <div class="kv">
          <span class="k">trust</span>
          <span><span class="trustbar"><span class="fill" style="width:${trust * 100}%;background:hsl(${catHue},40%,55%)"></span><span class="minline" style="left:${(store.stats.min_trust ?? 0.3) * 100}%" title="min_trust ${store.stats.min_trust ?? 0.3} — prefetch/search floor"></span></span> <span class="v">${trust.toFixed(2)}</span></span>
          <span class="k">retrievals</span><span class="v">${fact.journal_retrievals ?? local?.retrieval_count ?? 0}× <span class="k">(journal-observed)</span></span>
          <span class="k">helpful</span><span class="v">${fact.helpful_count}×</span>
        </div>
        <div class="ts">created&nbsp;&nbsp;${fact.created_at}<br>updated&nbsp;&nbsp;${fact.updated_at}</div>
        <div class="ent-chips">${entChips}</div>
        <div class="vecline">hrr_vector&nbsp;&nbsp;${fact.vector_bytes ? `${fact.vector_bytes} B (${store.stats.hrr_dim ?? 1024} × f64)` : "NULL — not in the algebra"}</div>
        <div class="linkrow">
          ${fact.vector_bytes ? `<a id="ins-algebra">inspect algebra</a>` : `<a id="ins-backfill">backfill vector</a>`}
          <a id="ins-export">export fact</a>
          <a id="ins-reason">reason…</a>
        </div>
        <div class="actions">
          <button class="btn good" id="fb-up">👍 helpful</button>
          <button class="btn bad" id="fb-down">👎 unhelpful</button>
          <button class="btn undo" id="ins-undo" title="undo the most recent journaled change to this fact">↶ undo</button>
          <button class="btn del" id="ins-del">delete</button>
        </div>
        <div class="kv" style="margin-top:10px">
          <span class="k">set trust</span>
          <span><input type="range" id="trust-slider" min="0" max="1" step="0.05" value="${trust}" style="width:120px;vertical-align:middle"> <span class="v" id="trust-val">${trust.toFixed(2)}</span></span>
        </div>
      </div>`;
    this.bindSingle(id, fact);
  }

  private renderMulti(sel: number[]): void {
    const facts = sel.map((i) => store.facts.get(i)).filter(Boolean) as any[];
    const mean = facts.reduce((a, f) => a + f.trust_score, 0) / (facts.length || 1);
    const cats = new Map<string, number>();
    let retr = 0, help = 0;
    for (const f of facts) {
      cats.set(f.category, (cats.get(f.category) ?? 0) + 1);
      retr += f.retrieval_count; help += f.helpful_count;
    }
    const catRows = [...cats.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) =>
      `<span class="k">${escapeHtml(c)}</span><span class="v">${"▓".repeat(Math.max(1, Math.round(n / facts.length * 10)))} ${n}</span>`).join("");
    this.el.innerHTML = `
      <div class="pane-label">Inspect</div>
      <div class="factid">${facts.length} facts selected</div>
      <div class="inspect-body">
        <div class="kv">
          <span class="k">mean trust</span><span class="v">${mean.toFixed(2)}</span>
          <span class="k">retrievals</span><span class="v">${retr}×</span>
          <span class="k">helpful</span><span class="v">${help}×</span>
        </div>
        <div class="kv">${catRows}</div>
        <div class="actions">
          <button class="btn good" id="bulk-up">bulk 👍</button>
          <button class="btn bad" id="bulk-down">bulk 👎</button>
          <button class="btn" id="bulk-export">bulk export</button>
          <button class="btn" id="bulk-ask">ask the agent…</button>
        </div>
      </div>`;
    (this.el.querySelector("#bulk-up") as HTMLElement).onclick = () => this.bulkFeedback(sel, true);
    (this.el.querySelector("#bulk-down") as HTMLElement).onclick = () => this.bulkFeedback(sel, false);
    (this.el.querySelector("#bulk-export") as HTMLElement).onclick = () => this.exportFacts(sel);
    (this.el.querySelector("#bulk-ask") as HTMLElement).onclick = () =>
      (window as any).eyeAskAgent(sel);
  }

  private async bulkFeedback(ids: number[], helpful: boolean): Promise<void> {
    for (const idNum of ids) {
      try { await rpc("fact.feedback", { fact_id: idNum, helpful }); } catch { /* keep going */ }
    }
    (window as any).eyeRefresh();
  }

  private async exportFacts(ids: number[]): Promise<void> {
    const out = [];
    for (const idNum of ids) {
      try {
        out.push((await rpc("fact.get", { fact_id: idNum, include_vector: true })).fact);
      } catch { /* skip */ }
    }
    const blob = new Blob([JSON.stringify(ids.length === 1 ? out[0] : out, null, 2)],
                          { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = ids.length === 1
      ? `holo_eye_fact_${String(ids[0]).padStart(4, "0")}.json`
      : `holo_eye_facts_${ids.length}.json`;
    a.click();
  }

  private bindSingle(id: number, fact: any): void {
    const q = (sel: string) => this.el.querySelector<HTMLElement>(sel);
    q("#fb-up")!.onclick = async () => {
      await rpc("fact.feedback", { fact_id: id, helpful: true }); (window as any).eyeRefresh();
    };
    q("#fb-down")!.onclick = async () => {
      await rpc("fact.feedback", { fact_id: id, helpful: false }); (window as any).eyeRefresh();
    };
    q("#ins-del")!.onclick = () => openDeleteModal(id, fact);
    q("#ins-undo")!.onclick = async () => {
      const res = await rpc("journal.tail", { limit: 400 });
      const ev = (res.events as EyeEvent[]).find((e) => {
        if (e.undone_by || e.source === "undo" || e.source === "prefetch") return false;
        const req = e.request ? safeParse(e.request) : {};
        const resp = e.response ? safeParse(e.response) : {};
        return Number(resp.fact_id ?? req.fact_id) === id;
      });
      if (!ev) { alert("no undoable journal event touches this fact"); return; }
      try {
        await rpc("undo", { event_id: ev.event_id });
        (window as any).eyeRefresh();
      } catch (err: any) { alert(err.message); }
    };
    q("#ins-export")!.onclick = () => this.exportFacts([id]);
    q("#ins-reason")!.onclick = () =>
      openWorkbench((fact.links ?? []).slice(0, 3).map((l: any) => l.name));
    const alg = q("#ins-algebra");
    if (alg) alg.onclick = () => openFft(id, fact);
    const backfill = q("#ins-backfill");
    if (backfill) backfill.onclick = async () => {
      await rpc("backfill_vectors", {}); (window as any).eyeRefresh();
    };
    this.el.querySelectorAll<HTMLElement>(".ent-chip").forEach((chip) => {
      chip.onclick = () => highlightEntity(chip.dataset.name!);
    });

    const slider = q("#trust-slider") as HTMLInputElement;
    slider.oninput = () => { q("#trust-val")!.textContent = Number(slider.value).toFixed(2); };
    slider.onchange = async () => {
      await rpc("fact.trust_set", { fact_id: id, trust: Number(slider.value) });
      (window as any).eyeRefresh();
    };

    q("#edit-content")!.onclick = () => {
      const contentEl = q("#ins-content")!;
      const ta = document.createElement("textarea");
      ta.className = "edit-ta"; ta.value = fact.content; ta.rows = 6;
      contentEl.replaceWith(ta); ta.focus();
      ta.onkeydown = async (e) => {
        if (e.key === "Escape") { this.render(); }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          openEditPreview(id, { content: ta.value });
        }
      };
    };
    q("#edit-category")!.onclick = () => {
      const cats = Object.keys(store.stats.categories ?? CAT_HUES);
      const next = prompt(`category (${cats.join(" / ")}):`, fact.category);
      if (next && next !== fact.category) openEditPreview(id, { category: next });
    };
    q("#edit-tags")!.onclick = () => {
      const next = prompt("tags (comma-separated):", fact.tags);
      if (next !== null && next !== fact.tags) openEditPreview(id, { tags: next });
    };
  }
}
