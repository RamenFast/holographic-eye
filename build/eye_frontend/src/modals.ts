/* Modals: Reason Workbench, FFT inspector, edit preview, typed-ID delete,
   Backup Memory (D-0007), ask-the-agent (P6), help. PART 6 §6–7.
   GPLv3 — see LICENSE. */

import { rpc } from "./api";
import { getStored, setStored } from "./storage";
import { store, fid, CAT_HUES, catColor, THEMES, theme, applyTheme,
         rgba } from "./state";
import { regrowGarden } from "./garden";
import { escapeHtml } from "./field";

let fieldRef: any = null;
export function setField(f: any): void { fieldRef = f; }

let activeModalClose: (() => void) | null = null;
let modalSerial = 0;
const modalClosers = new WeakMap<HTMLElement, () => void>();

function closeModal(back: HTMLElement): void {
  modalClosers.get(back)?.();
}

function modalIsOpen(back: HTMLElement): boolean {
  return document.contains(back) && modalClosers.has(back);
}

function modal(title: string, body: string, width = 720): HTMLElement {
  activeModalClose?.();
  const priorFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement : null;
  const back = document.createElement("div");
  const titleId = `eye-modal-title-${++modalSerial}`;
  back.className = "modal-back";
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1" style="width:${width}px">
    <div class="m-title" id="${titleId}">${title}<button type="button" class="m-close" aria-label="Close dialog" style="background:none;border:0;font:inherit;padding:0">esc ✕</button></div>
    <div class="m-body">${body}</div></div>`;
  document.body.appendChild(back);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    removeEventListener("keydown", onKeydown);
    modalClosers.delete(back);
    if (activeModalClose === close) activeModalClose = null;
    back.dispatchEvent(new Event("eye:close"));
    back.remove();
    if (store.reasonHalo) {
      store.reasonHalo = null;
      store.emit("halo");
      fieldRef?.logMath([]);
    }
    if (priorFocus && document.contains(priorFocus)) priorFocus.focus();
  };
  const focusable = () => [...back.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
  )].filter((el) => !el.hasAttribute("hidden"));
  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const items = focusable();
    if (!items.length) {
      event.preventDefault();
      (back.querySelector<HTMLElement>(".modal")!).focus();
      return;
    }
    const first = items[0], last = items[items.length - 1];
    if (!back.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  };
  modalClosers.set(back, close);
  activeModalClose = close;
  back.querySelector<HTMLElement>(".m-close")!.onclick = close;
  back.onclick = (event) => { if (event.target === back) close(); };
  addEventListener("keydown", onKeydown);
  queueMicrotask(() => {
    if (!modalIsOpen(back)) return;
    const preferred = back.querySelector<HTMLElement>("input:not([type=range]), textarea, select, button.commit");
    (preferred ?? focusable()[0] ?? back.querySelector<HTMLElement>(".modal"))?.focus();
  });
  return back;
}

// ---------------------------------------------------------------------------
// Reason Workbench (§7.1) — previews the recall, not the answer
// ---------------------------------------------------------------------------

export async function openWorkbench(initial: string[] = []): Promise<void> {
  const back = modal("REASON · workbench", `
    <div class="wb-input">
      <input id="wb-entities" placeholder="entities, comma-separated (e.g. hermes agent, telegram)"
        value="${escapeHtml(initial.join(", "))}">
      <button class="btn" id="wb-run">run</button>
    </div>
    <pre class="wb-math" id="wb-math">the workbench previews the recall, not the answer —
what the agent WOULD have been handed for these entities.</pre>
    <div id="wb-results"></div>
    <div class="wb-thresh">threshold <input type="range" id="wb-slider" min="0" max="1" step="0.05" value="0.5">
      <span class="v" id="wb-tval">0.50</span></div>`);
  const q = (s: string) => back.querySelector<HTMLElement>(s)!;
  // null = no run yet / computing — never show "nothing" until results exist
  let results: any[] | null = null;
  let requestId = 0;
  back.addEventListener("eye:close", () => { requestId++; }, { once: true });

  const render = () => {
    if (!modalIsOpen(back)) return;
    const th = Number((q("#wb-slider") as HTMLInputElement).value);
    q("#wb-tval").textContent = th.toFixed(2);
    if (results === null) return;
    const visible = results.filter((r) => r.score >= th);
    store.reasonHalo = store.reasonHalo
      ? { ...store.reasonHalo, factIds: new Set(visible.map((r) => r.fact_id)) }
      : null;
    store.emit("halo");
    q("#wb-results").innerHTML = visible.length
      ? visible.map((r, i) => `
        <div class="wb-row" data-fid="${r.fact_id}">
          <div class="wb-line1"><span class="v">${i + 1}.</span> <b>${fid(r.fact_id)}</b>
            ${Object.entries(r.entity_sims ?? {}).map(([e, s]) =>
              `<span class="wb-sim">${escapeHtml(e)}=${s}</span>`).join(" ")}
            <span class="wb-sim">trust=${Number(r.trust_score).toFixed(2)}</span>
            <span class="v">score=${Number(r.score).toFixed(3)}</span></div>
          <div class="wb-line2">“${escapeHtml(String(r.content).slice(0, 110))}…”</div>
        </div>`).join("")
      : `<div class="pane-hint">no results above threshold ${th.toFixed(2)} — lower the slider,
         or the agent genuinely would recall nothing for this combination</div>`;
    q("#wb-results").querySelectorAll<HTMLElement>(".wb-row").forEach((row) => {
      row.onclick = () => store.select([Number(row.dataset.fid)]);
    });
  };

  const run = async () => {
    if (!modalIsOpen(back)) return;
    const entities = (q("#wb-entities") as HTMLInputElement).value
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (!entities.length) return;
    const mine = ++requestId;
    const runButton = q("#wb-run") as HTMLButtonElement;
    runButton.disabled = true;
    results = null;
    q("#wb-math").textContent = "running the provider's reason() …";
    q("#wb-results").innerHTML =
      `<div class="pane-hint">⊙ computing — unbinding ${entities.length} probe key(s) across the store…</div>`;
    try {
      const res = await rpc("reason.explain", { entities, limit: 20 });
      if (!modalIsOpen(back) || mine !== requestId) return;
      if (!Array.isArray(res.results) || !Array.isArray(res.math)) {
        throw new Error("reason.explain returned malformed results. Check the gateway log, then retry.");
      }
      results = res.results;
      q("#wb-math").textContent = res.math.join("\n");
      store.reasonHalo = { entities, factIds: new Set() };
      store.emit("halo");
      fieldRef?.logMath(res.math);
      render();
    } catch (err: any) {
      if (!modalIsOpen(back) || mine !== requestId) return;
      q("#wb-math").textContent = String(err?.message ?? err);
      q("#wb-results").innerHTML = "";
    } finally {
      if (modalIsOpen(back) && mine === requestId) runButton.disabled = false;
    }
  };
  q("#wb-run").onclick = run;
  (q("#wb-entities") as HTMLInputElement).onkeydown = (e) => {
    if (e.key === "Enter" && !(q("#wb-run") as HTMLButtonElement).disabled) void run();
  };
  (q("#wb-slider") as HTMLInputElement).oninput = render;
  if (initial.length) run();
}

// ---------------------------------------------------------------------------
// FFT inspector (§6)
// ---------------------------------------------------------------------------

export async function openFft(factId: number, fact: any): Promise<void> {
  const entNames: string[] = (fact.links ?? []).map((l: any) => l.name);
  const back = modal(`ALGEBRA · ${fid(factId)}`, `
    <canvas id="fft-canvas" width="640" height="260" style="width:100%"></canvas>
    <div class="fft-legend" id="fft-legend"></div>
    <div class="fft-toggles" id="fft-toggles">
      <label><input type="checkbox" checked data-t="fact"> fact</label>
      ${entNames.map((n) => `<label><input type="checkbox" data-t="ent" data-name="${escapeHtml(n)}"> entity:${escapeHtml(n)}</label>`).join("")}
      <label><input type="checkbox" data-t="bank"> bank:${escapeHtml(fact.category)}</label>
    </div>
    <pre class="wb-math" id="fft-comp">…</pre>
    <div class="pane-hint">bind = phase addition → the bundled spectrum is the true interference
    pattern of the bound components. real math, real data, real plot.</div>`, 700);
  const q = (s: string) => back.querySelector<HTMLElement>(s)!;

  let requestId = 0;
  back.addEventListener("eye:close", () => { requestId++; }, { once: true });
  const draw = async () => {
    if (!modalIsOpen(back)) return;
    const mine = ++requestId;
    const boxes = [...back.querySelectorAll<HTMLInputElement>("#fft-toggles input")];
    const wantFact = boxes.find((b) => b.dataset.t === "fact")!.checked;
    const ents = boxes.filter((b) => b.dataset.t === "ent" && b.checked).map((b) => b.dataset.name!);
    const banks = boxes.find((b) => b.dataset.t === "bank")!.checked ? [fact.category] : [];
    const params: any = { entities: ents, banks };
    if (wantFact) params.fact_id = factId;
    if (!wantFact && !ents.length && !banks.length) {
      const canvas = q("#fft-canvas") as HTMLCanvasElement;
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      q("#fft-legend").textContent = "select at least one trace";
      q("#fft-comp").textContent = "";
      return;
    }
    q("#fft-comp").textContent = "loading spectrum…";
    try {
      const res = await rpc("fact.spectrum", params);
      if (!modalIsOpen(back) || mine !== requestId) return;
      if (!Array.isArray(res.traces)) {
        throw new Error("fact.spectrum returned malformed traces. Check the gateway log, then retry.");
      }
      const canvas = q("#fft-canvas") as HTMLCanvasElement;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const colors: Record<string, string> = {
        fact: catColor(fact.category, 0.9),
        entity: theme.acting,
        bank: rgba(theme.numericsRgb, 0.55),
      };
      const W = canvas.width, H = canvas.height - 18;
      ctx.strokeStyle = rgba(theme.inkRgb, 0.12);
      ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
      let legend = "";
      for (const trace of res.traces) {
        const bins: number[] = Array.isArray(trace.bins) ? trace.bins : [];
        if (!bins.length) continue;
        ctx.beginPath();
        for (let x = 0; x < W; x++) {
          const i = Math.min(bins.length - 1, Math.floor((x / W) * bins.length));
          const y = H - Number(bins[i] || 0) * (H - 8) - 4;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.strokeStyle = colors[trace.kind] ?? theme.textDim;
        ctx.lineWidth = 1;
        ctx.stroke();
        legend += `<span style="color:${colors[trace.kind]}">■</span> ${escapeHtml(String(trace.label ?? "?"))} &nbsp;`;
      }
      ctx.fillStyle = theme.textDim; ctx.font = "10px ui-monospace, monospace";
      for (const bin of [0, 256, 512, 768, 1023]) {
        ctx.fillText(String(bin), (bin / 1023) * (W - 30), canvas.height - 4);
      }
      q("#fft-legend").innerHTML = legend;
      q("#fft-comp").textContent = res.composition?.length
        ? "composition:\n" + res.composition.map((c: any) =>
          `  ${c.component}   (peak at bin ${c.peak_bin})`).join("\n")
        : "";
    } catch (err: any) {
      if (!modalIsOpen(back) || mine !== requestId) return;
      q("#fft-comp").textContent = String(err?.message ?? err);
    }
  };
  back.querySelectorAll("#fft-toggles input").forEach((b) =>
    (b as HTMLInputElement).onchange = draw);
  void draw();
}

// ---------------------------------------------------------------------------
// Edit preview (§7.2) — server-computed impact, then commit
// ---------------------------------------------------------------------------

let editPreviewRequest = 0;
export async function openEditPreview(factId: number, changes: any): Promise<void> {
  const mine = ++editPreviewRequest;
  const modalAtRequest = modalSerial;
  let pv: any;
  try {
    pv = await rpc("fact.preview_update", { fact_id: factId, ...changes });
  } catch (err: any) {
    if (mine === editPreviewRequest) alert(String(err?.message ?? err));
    return;
  }
  if (mine !== editPreviewRequest || modalSerial !== modalAtRequest) return;
  if (!pv?.before || !pv?.after || typeof pv.before.content !== "string" ||
      typeof pv.after.content !== "string" || !Array.isArray(pv.predicted_entities) ||
      !Array.isArray(pv.entities_removed) || !Array.isArray(pv.bank_impact)) {
    alert("fact.preview_update returned malformed data. Check the gateway log, then retry.");
    return;
  }
  const ents = pv.predicted_entities.map((p: any) =>
    `${escapeHtml(String(p?.name ?? "?"))}${p?.exists ? "" : " (new)"}`).join(", ") || "none";
  const removed = pv.entities_removed.length
    ? `<div class="q-body dim">removed: ${pv.entities_removed.map((name: unknown) => escapeHtml(String(name))).join(", ")}</div>` : "";
  const banks = pv.bank_impact.map((b: any) =>
    `${escapeHtml(String(b?.bank ?? "?"))} · ${Number(b?.fact_count) || 0} facts · rebuilding`).join(" &nbsp;·&nbsp; ");
  const back = modal(`COMMIT EDIT · ${fid(factId)}`, `
    <div class="ep-label">before</div>
    <pre class="ep-block">${escapeHtml(pv.before.content)}</pre>
    <div class="ep-label">after</div>
    <pre class="ep-block ep-after">${escapeHtml(pv.after.content)}</pre>
    ${changes.category ? `<div class="q-body">category: ${escapeHtml(String(pv.before.category))} → <b>${escapeHtml(String(pv.after.category))}</b></div>` : ""}
    ${changes.tags !== undefined ? `<div class="q-body">tags: ${escapeHtml(String(pv.after.tags ?? ""))}</div>` : ""}
    <div class="q-body">predicted entities: ${ents}</div>${removed}
    <div class="q-body dim">bank impact: ${banks}</div>
    <div class="q-body dim" id="ep-status" role="status"></div>
    <div class="m-actions"><button type="button" class="btn" id="ep-cancel">cancel</button>
      <button type="button" class="btn commit" id="ep-commit">commit</button></div>`, 620);
  back.querySelector<HTMLElement>("#ep-cancel")!.onclick = () => closeModal(back);
  back.querySelector<HTMLElement>("#ep-commit")!.onclick = async () => {
    const button = back.querySelector<HTMLButtonElement>("#ep-commit")!;
    const status = back.querySelector<HTMLElement>("#ep-status")!;
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "committing…";
    status.textContent = "Waiting for the journaled update.";
    try {
      await rpc("fact.update", { fact_id: factId, ...changes });
      if (!modalIsOpen(back)) return;
      closeModal(back);
      await (window as any).eyeRefresh();
    } catch (err: any) {
      if (!modalIsOpen(back)) return;
      status.textContent = String(err?.message ?? err);
      button.textContent = err?.outcome === "unknown" ? "outcome unknown" : "commit";
      button.disabled = err?.outcome === "unknown";
    }
  };
}

// ---------------------------------------------------------------------------
// Delete confirmation (§7.3) — typed-ID, deliberately annoying
// ---------------------------------------------------------------------------

export function openDeleteModal(factId: number, fact: any): void {
  const idStr = String(factId);
  const back = modal(`DELETE · ${fid(factId)}`, `
    <div class="q-body">“${escapeHtml(fact.content.slice(0, 160))}”</div>
    <div class="q-body dim">trust ${Number(fact.trust_score).toFixed(2)} ·
      retrieved ${fact.journal_retrievals ?? 0}× · helpful ${fact.helpful_count}×</div>
    <div class="q-body dim">bank cat:${escapeHtml(fact.category)} will be rebuilt · undo stays available in the queue</div>
    <div class="q-body">type <b class="v">${idStr}</b> to confirm:
      <input id="del-confirm" class="del-input" maxlength="${idStr.length + 2}" autocomplete="off"></div>
    <div class="q-body dim" id="del-status" role="status"></div>
    <div class="m-actions"><button type="button" class="btn" id="del-cancel">cancel</button>
      <button type="button" class="btn del" id="del-go" disabled>delete</button></div>`, 480);
  const input = back.querySelector<HTMLInputElement>("#del-confirm")!;
  const go = back.querySelector<HTMLButtonElement>("#del-go")!;
  const status = back.querySelector<HTMLElement>("#del-status")!;
  input.focus();
  input.oninput = () => { go.disabled = input.value.trim() !== idStr; };
  back.querySelector<HTMLElement>("#del-cancel")!.onclick = () => closeModal(back);
  go.onclick = async () => {
    if (go.disabled) return;
    go.disabled = true;
    go.textContent = "deleting…";
    status.textContent = "Waiting for the journaled delete.";
    try {
      await rpc("fact.remove", { fact_id: factId });
      if (!modalIsOpen(back)) return;
      closeModal(back);
      store.clearSelection();
      await (window as any).eyeRefresh();
    } catch (err: any) {
      if (!modalIsOpen(back)) return;
      status.textContent = String(err?.message ?? err);
      go.textContent = err?.outcome === "unknown" ? "outcome unknown" : "delete";
      go.disabled = err?.outcome === "unknown" || input.value.trim() !== idStr;
    }
  };
}

// ---------------------------------------------------------------------------
// Backup Memory (D-0007)
// ---------------------------------------------------------------------------

export async function openBackup(): Promise<void> {
  const back = modal("BACKUP MEMORY", `
    <div class="q-body">consistent snapshot of <b>memory_store.db</b> + <b>eye_journal.db</b>
      (sqlite backup API — safe while the gateway runs). restore is a cold operation: stop
      gateway → copy back → start.</div>
    <div class="q-body" id="bk-dests">loading destinations…</div>
    <div class="q-body">destination:
      <input id="bk-dest" class="bk-input" spellcheck="false"></div>
    <div class="q-body">label (optional): <input id="bk-label" class="bk-input" placeholder="e.g. pre-cleanup"></div>
    <div class="q-body dim" id="bk-status" role="status"></div>
    <div class="m-actions"><button type="button" class="btn commit" id="bk-create">create backup</button></div>
    <div class="ep-label">existing backups</div>
    <div id="bk-list" class="q-list" style="max-height:200px;overflow:auto">…</div>`, 640);
  const q = (s: string) => back.querySelector<HTMLElement>(s)!;
  let refreshId = 0;
  back.addEventListener("eye:close", () => { refreshId++; }, { once: true });

  const refresh = async () => {
    const mine = ++refreshId;
    try {
      const res = await rpc("backup.list", {});
      if (!modalIsOpen(back) || mine !== refreshId) return;
      if (!Array.isArray(res.known_dests) || !Array.isArray(res.backups)) {
        throw new Error("backup.list returned malformed data. Check the gateway log, then retry.");
      }
      const dest = q("#bk-dest") as HTMLInputElement;
      if (!dest.value) dest.value = String(res.default_dest ?? "");
      q("#bk-dests").innerHTML = "presets: " + res.known_dests.map((value: unknown) => {
        const d = String(value);
        return `<button type="button" class="btn bk-preset" data-d="${escapeHtml(d)}">${escapeHtml(d.includes("Mass storage") ? "🗄 Mass storage" : "~/.hermes/backups")}</button>`;
      }).join(" · ") + (res.mass_storage_mounted ? "" :
        ' <span class="warn">(mass storage not mounted)</span>');
      back.querySelectorAll<HTMLElement>(".bk-preset").forEach((button) => {
        button.onclick = () => { dest.value = button.dataset.d!; };
      });
      q("#bk-list").innerHTML = res.backups.length ? res.backups.map((b: any) => `
        <div class="q-row"><div class="q-head"><span class="q-kind">${escapeHtml(String(b.name ?? "?"))}</span>
          <span class="q-fid">${b.facts ?? "?"} facts</span></div>
          <div class="q-body dim">${escapeHtml(String(b.path ?? "?"))} · ${(Number(b.bytes) / 1048576).toFixed(1)} MB</div></div>`).join("")
        : '<div class="pane-hint">no backups yet</div>';
    } catch (err: any) {
      if (!modalIsOpen(back) || mine !== refreshId) return;
      q("#bk-dests").textContent = String(err?.message ?? err);
      q("#bk-list").innerHTML = "";
    }
  };
  q("#bk-create").onclick = async () => {
    const btn = q("#bk-create") as HTMLButtonElement;
    if (btn.disabled) return;
    btn.disabled = true;
    btn.textContent = "backing up…";
    q("#bk-status").textContent = "Waiting for the snapshot manifest.";
    try {
      const res = await rpc("backup.create", {
        dest_dir: (q("#bk-dest") as HTMLInputElement).value.trim(),
        label: (q("#bk-label") as HTMLInputElement).value.trim(),
      });
      if (!modalIsOpen(back)) return;
      btn.textContent = `✓ ${res.manifest?.facts ?? "?"} facts backed up`;
      q("#bk-status").textContent = "Backup completed.";
      await refresh();
      window.setTimeout(() => {
        if (!modalIsOpen(back)) return;
        btn.disabled = false;
        btn.textContent = "create backup";
      }, 2500);
    } catch (err: any) {
      if (!modalIsOpen(back)) return;
      q("#bk-status").textContent = String(err?.message ?? err);
      btn.textContent = err?.outcome === "unknown" ? "outcome unknown" : "create backup";
      btn.disabled = err?.outcome === "unknown";
    }
  };
  void refresh();
}

// ---------------------------------------------------------------------------
// Ask the agent (P6) — compose over selected facts, inject via api_server
// ---------------------------------------------------------------------------

export function openAskAgent(sel: number[]): void {
  const facts = sel.map((i) => store.facts.get(i)).filter(Boolean) as any[];
  const list = facts.map((f) =>
    `${fid(f.fact_id)} [${f.category}] "${f.content.slice(0, 90)}"`).join("\n");
  const back = modal("ASK THE AGENT", `
    <div class="q-body dim">composes a request over the selected facts and injects it into an
      agent session via the gateway api_server. the agent's mutations flow back through the
      stream and queue.</div>
    <div class="q-body ask-target">
      <label class="k" for="ask-session">lands in session:</label>
      <select id="ask-session"><option value="eye-console">eye-console (the Eye's own session)</option></select>
      <span class="q-fid" id="ask-eye-session" title="the session the wrapper provider is currently attached to inside the gateway"></span>
    </div>
    ${list ? `<pre class="ep-block">${escapeHtml(list)}</pre>` : ""}
    <label class="q-body" for="ask-text">request:</label>
    <textarea id="ask-text" class="edit-ta" rows="3">Please review these memory facts (by fact_id) and tidy them: dedupe, fix wording, correct categories. Use fact_store update/remove as needed.\n${sel.map((i) => fid(i)).join(", ")}</textarea>
    <div class="m-actions">
      <button type="button" class="btn" id="ask-copy">copy prompt</button>
      <button type="button" class="btn commit" id="ask-send">send to agent</button></div>
    <div class="q-body dim" id="ask-status" role="status" aria-live="polite"></div>`, 660);
  const q = (s: string) => back.querySelector<HTMLElement>(s)!;
  let sessionRequest = 0;
  let timer: number | undefined;
  back.addEventListener("eye:close", () => {
    sessionRequest++;
    if (timer !== undefined) clearInterval(timer);
  }, { once: true });

  // live session list — refreshed every 8s while the modal is open (#9)
  const refreshSessions = async () => {
    if (!modalIsOpen(back)) return;
    const mine = ++sessionRequest;
    try {
      const res = await rpc("agent.sessions", {});
      if (!modalIsOpen(back) || mine !== sessionRequest) return;
      const sess = q("#ask-eye-session");
      sess.textContent = res.eye_attached_session
        ? `eye attached: ${res.eye_attached_session}` : "";
      if (res.ok && Array.isArray(res.sessions)) {
        const select = q("#ask-session") as HTMLSelectElement;
        const current = select.value;
        const opts = [`<option value="eye-console">eye-console (the Eye's own session)</option>`]
          .concat(res.sessions.slice(0, 25).map((s: any) => {
            const label = s.title || s.session_id;
            const plat = s.platform ? ` · ${s.platform}` : "";
            return `<option value="${escapeHtml(String(s.session_id ?? ""))}">${escapeHtml(String(label).slice(0, 60))}${escapeHtml(plat)}</option>`;
          }));
        select.innerHTML = opts.join("");
        if ([...select.options].some((o) => o.value === current)) select.value = current;
      }
    } catch (err: any) {
      if (modalIsOpen(back) && mine === sessionRequest) {
        q("#ask-eye-session").textContent = `session list unavailable: ${String(err?.message ?? err)}`;
      }
    }
  };
  timer = window.setInterval(() => void refreshSessions(), 8000);
  void refreshSessions();

  q("#ask-copy").onclick = async () => {
    const copy = q("#ask-copy") as HTMLButtonElement;
    if (copy.disabled) return;
    copy.disabled = true;
    try {
      await navigator.clipboard.writeText((q("#ask-text") as HTMLTextAreaElement).value);
      if (modalIsOpen(back)) q("#ask-status").textContent = "Copied. Paste it to the agent on any platform.";
    } catch (err: any) {
      if (modalIsOpen(back)) {
        q("#ask-status").textContent = `Copy failed: ${String(err?.message ?? err)}. Select the prompt and copy it manually.`;
      }
    } finally {
      if (modalIsOpen(back)) copy.disabled = false;
    }
  };
  q("#ask-send").onclick = async () => {
    const send = q("#ask-send") as HTMLButtonElement;
    if (send.disabled) return;
    const target = (q("#ask-session") as HTMLSelectElement).value;
    send.disabled = true;
    send.textContent = "sending…";
    q("#ask-status").textContent = `Sending to session "${target}"…`;
    let res: any;
    try {
      res = await rpc("agent.ask", {
        prompt: (q("#ask-text") as HTMLTextAreaElement).value,
        fact_ids: sel,
        session_id: target,
      });
    } catch (err: any) {
      if (!modalIsOpen(back)) return;
      const uncertain = err?.outcome === "unknown";
      q("#ask-status").textContent = uncertain
        ? String(err?.message ?? err)
        : `${String(err?.message ?? err)} Copy the prompt if you want to use the manual fallback.`;
      send.textContent = uncertain ? "outcome unknown" : "send to agent";
      send.disabled = uncertain;
      return;
    }
    if (!modalIsOpen(back)) return;
    send.textContent = "sent";
    send.disabled = true;
    q("#ask-status").textContent =
      `Sent to ${String(res.session_id)}. Agent replied: ${String(res.reply).slice(0, 220)}`;
    try {
      await (window as any).eyeRefresh();
    } catch (err: any) {
      if (modalIsOpen(back)) q("#ask-status").textContent +=
        ` Read refresh failed: ${String(err?.message ?? err)}. The request was already sent.`;
    }
  };
}

// ---------------------------------------------------------------------------
// Legend + glossary — the ? manual is the ONE canonical copy (r2 #5/#12);
// Settings links here instead of duplicating it
// ---------------------------------------------------------------------------

function legendHtml(): string {
  const cats = Object.keys(store.stats.categories ?? CAT_HUES);
  const swatches = cats.map((c) =>
    `<span class="lg-swatch"><i style="background:${catColor(c, 0.75)}"></i>${escapeHtml(c)}
     <span class="v">${store.stats.categories?.[c] ?? ""}</span></span>`).join("");
  return `
    <div class="ep-label">the field — what you're looking at</div>
    <div class="lg-swatches">${swatches}</div>
    <div class="kv help-kv">
      <span class="k">hue</span><span>category (above — counts from the live store)</span>
      <span class="k">saturation</span><span>trust score — washed-out dots are untrusted, vivid dots are trusted</span>
      <span class="k">size</span><span>how often the fact appeared in recalls (journal-observed)</span>
      <span class="k">position</span><span>PCA of the fact's real 1024-d HRR phase vector — nearby dots are algebraically similar</span>
      <span class="k">pink ring</span><span>selected, or structurally hit by the active entity probe</span>
      <span class="k">gold ring</span><span>above the Reason Workbench threshold — would be recalled</span>
      <span class="k">hollow rings (strip)</span><span>facts with no HRR vector — outside the algebra until backfilled</span>
    </div>
    <div class="pane-hint">themes are palette rows (⚙ → theme, the sysmon/Phosphor way); the
      semantic rule survives every room: <b>accent</b> = what you're acting on,
      <b>gold/value</b> = the reference you act against, red = danger.</div>`;
}

function glossaryHtml(): string {
  const terms: [string, string][] = [
    ["fact", "one stored memory row: content + category + tags + trust + an HRR vector. The atoms of this whole system."],
    ["trust", "0.0–1.0 weight on every fact. Recall ranking multiplies by it; anything under min_trust (gold line, 0.3) is filtered out of prefetch/search entirely. 👍/👎 move it by +0.05/−0.10."],
    ["HRR vector", "Holographic Reduced Representation — the fact encoded as 1024 phase angles. bind = phase addition, unbind = subtraction, bundle = superposition. This is the actual math the provider runs, and what the Field draws."],
    ["entity", "a name the provider regex-extracted from fact content (capitalized phrases, quoted strings). Facts link to entities; probe/reason navigate through them. The regex also mints junk — that's what the Entity Desk (right-click) is for."],
    ["probe", "asks: what does memory hold about THIS entity? Algebraic: unbind(fact, bind(entity, ROLE_ENTITY)) — not keyword search."],
    ["reason", "probe across MULTIPLE entities at once, AND-combined (min of similarities). The Workbench shows you exactly what the agent would be handed."],
    ["bank", "one bundled vector per category (cat:project, …) — the superposition of all its facts' vectors. Rebuilt after every add/update/remove."],
    ["SNR", "signal-to-noise √(dim/facts). Below 2.0 (gold ⚠) the superposition is crowded and recall accuracy degrades — that's a real capacity warning, not decoration."],
    ["prefetch", "before each agent turn, memory search runs on your message and the top-5 block is injected into context. The Stream's gold lines show the exact injected text."],
    ["mirror", "when the built-in memory tool writes, the provider mirrors it as a fact — a silent write path the journal makes visible."],
    ["auto-extract", "at session end, regex extraction mines facts from the conversation (enabled on this install). Journaled, undoable."],
    ["journal", "append-only event log (eye_journal.db) with full before/after images of every mutation — the undo substrate. Nothing edits blind."],
    ["undo", "restores the before-image byte-for-byte, vector included. Itself journaled. Lives in the QUEUE tab, on every fact, and as `hermes holographic-eye undo-last`."],
  ];
  return `<div class="ep-label">terminology</div><div class="kv help-kv gloss">` +
    terms.map(([t, d]) => `<span class="k">${t}</span><span>${d}</span>`).join("") +
    `</div>`;
}

// ---------------------------------------------------------------------------
// Settings — true settings ONLY, each explained in one plain sentence
// (r2 #5/#12). The legend + glossary live in the ? manual, linked below.
// ---------------------------------------------------------------------------

const UI_SCALES = new Set(["0.85", "1", "1.1", "1.25"]);

function storedUiScale(): string {
  const stored = getStored("eyeUiScale") ?? "1";
  if (UI_SCALES.has(stored)) return stored;
  setStored("eyeUiScale", "1");
  return "1";
}

/** Apply persisted UI preferences (text size, garden). Called at boot and
    whenever a setting changes. */
export function applyUiPrefs(): void {
  const scale = Number(storedUiScale());
  document.documentElement.style.fontSize = `${(13 * scale).toFixed(2)}px`;
  document.body.classList.toggle("no-garden",
    getStored("eyeGarden") === "off");
}

export function openSettings(): void {
  const s = store.stats;
  const scale = storedUiScale();
  const garden = getStored("eyeGarden") !== "off";
  let geometry: any = null;
  try { geometry = fieldRef?.geometryStatus?.() ?? null; } catch { /* show unavailable honestly */ }
  const geometryMode = geometry?.mode === "wasm" ? "Zig/WASM"
    : geometry?.mode === "javascript" ? "JavaScript fallback" : "loading";
  const packed = Number.isFinite(geometry?.packedFacts)
    ? `${geometry.packedFacts} packed facts` : "packed fact count loading";
  const geometryReason = geometry?.reason
    ? `Fallback reason: ${escapeHtml(String(geometry.reason))}`
    : geometryMode === "Zig/WASM"
      ? "Field hit testing is using the loaded Zig WebAssembly kernel."
      : geometryMode === "JavaScript fallback"
        ? "The WebAssembly kernel is unavailable. Field hit testing remains exact in JavaScript."
        : "The geometry kernel is still loading. Settings reads this status when opened.";
  const back = modal("⚙ SETTINGS", `
    <div class="q-body dim">switches and controls only — the field legend, keys, and
      terminology live in the <a id="st-manual">? manual</a> (one canonical copy).</div>

    <div class="ep-label">appearance</div>
    <div class="st-row"><span class="st-k">theme</span>
      <span class="theme-grid">${THEMES.map((t) => `
        <button type="button" class="theme-chip${t.id === theme.id ? " active" : ""}" data-th="${t.id}"
          aria-pressed="${t.id === theme.id}" style="background:${t.bg};color:${t.ink};border-color:${t.accent}">
          <i style="background:${t.accent}"></i>${escapeHtml(t.label)}</button>`).join("")}
      </span>
      <span class="st-why">palette rows in the sysmon/Phosphor way — every canvas, dot and
        flower re-inks with the room. Blossom AMOLED is the original v3 true-black look.
        Remembered on this machine.</span></div>
    <div class="st-row"><span class="st-k">text size</span>
      <select id="st-scale">
        <option value="0.85"${scale === "0.85" ? " selected" : ""}>small · 85%</option>
        <option value="1"${scale === "1" ? " selected" : ""}>default · 100%</option>
        <option value="1.1"${scale === "1.1" ? " selected" : ""}>large · 110%</option>
        <option value="1.25"${scale === "1.25" ? " selected" : ""}>x-large · 125%</option>
      </select>
      <span class="st-why">scales every label and number in the app — remembered on this machine.</span></div>
    <div class="st-row"><span class="st-k">pixel garden</span>
      <label class="st-check"><input type="checkbox" id="st-garden"${garden ? " checked" : ""}>
        flowerbed lane + vines + cottage</label>
      <span class="st-why">purely decorative and grown fresh each launch (seeded, never tiled);
        it lives in its own lane and behind the Field, so it can never cover data.
        Switch it off for a bare instrument panel.</span></div>

    <div class="ep-label">performance</div>
    <div class="st-row"><span class="st-k">field geometry</span>
      <span class="v">${geometryMode} · ${packed}</span>
      <span class="st-why">${geometryReason}</span></div>

    <div class="ep-label">projection</div>
    <div class="st-row"><span class="st-k">refit</span>
      <button class="btn" id="st-refit">refit now</button>
      <span class="st-why">re-derives the map's two axes (PCA) from the current ${s.facts ?? "?"} facts.
        Day to day, new facts are placed in the existing basis so the map never jumps under you —
        refit when the layout stops matching the data. The current fit explains
        ${((store.projectionMeta?.explained_variance ?? [0, 0])
          .map((v: number) => (v * 100).toFixed(1)).join("% + "))}% of the variance.</span></div>

    <div class="ep-label">connection</div>
    <div class="st-row"><span class="st-k">session</span>
      <span class="st-why">the Eye is attached to gateway session <span class="v">${escapeHtml(s.session_id ?? "?")}</span>
        in <span class="v">${escapeHtml(s.mode ?? "journal")}</span> mode. Reads from this GUI never touch
        the agent; the wrapper adds ≈0.1–0.2&nbsp;ms per memory op and 0&nbsp;ms to prefetch.</span></div>
    <div class="st-row"><span class="st-k">token</span>
      <button class="btn" id="st-token">forget stored token</button>
      <span class="st-why">the control plane is loopback-only and bearer-token authed
        (~/.hermes/eye_token) — forget the stored copy if you pasted it on a shared browser.</span></div>`, 640);
  back.querySelector<HTMLElement>("#st-manual")!.onclick = () => openHelp();
  back.querySelectorAll<HTMLElement>(".theme-chip").forEach((chip) => {
    chip.onclick = () => {
      // applyTheme emits "theme" — the garden repaints through its own
      // listener; a second explicit regrow here caused the double-draw
      // that could land mid-bloom (feedback r3 glitch)
      applyTheme(chip.dataset.th!);
      back.querySelectorAll<HTMLElement>(".theme-chip").forEach((c) => {
        const active = c === chip;
        c.classList.toggle("active", active);
        c.setAttribute("aria-pressed", String(active));
      });
    };
  });
  back.querySelector<HTMLSelectElement>("#st-scale")!.onchange = (e) => {
    const value = (e.target as HTMLSelectElement).value;
    setStored("eyeUiScale", UI_SCALES.has(value) ? value : "1");
    applyUiPrefs();
  };
  back.querySelector<HTMLInputElement>("#st-garden")!.onchange = (e) => {
    setStored("eyeGarden",
      (e.target as HTMLInputElement).checked ? "on" : "off");
    applyUiPrefs();
    // canvases were display:none while off (sizes stale) — regrow, and
    // let it bloom: toggling the garden back on deserves the sprout
    regrowGarden(true);
  };
  back.querySelector<HTMLElement>("#st-refit")!.onclick = async () => {
    const button = back.querySelector<HTMLButtonElement>("#st-refit")!;
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = "refitting…";
    try {
      await (window as any).eyeRefit();
      if (modalIsOpen(back)) openSettings();
    } catch (err: any) {
      if (modalIsOpen(back)) {
        button.disabled = false;
        button.textContent = "refit now";
        alert(String(err?.message ?? err));
      }
    }
  };
  back.querySelector<HTMLElement>("#st-token")!.onclick = () => {
    if (confirm("forget stored token? you'll need to re-paste it")) {
      (window as any).eyeResetToken();
    }
  };
}

// ---------------------------------------------------------------------------
// Help / cheatsheet (§9)
// ---------------------------------------------------------------------------

export function openHelp(): void {
  modal("THE HOLOGRAPHIC EYE — manual", `
    <div class="ep-label">keys</div>
    <div class="kv help-kv">
      <span class="k">click / shift+click</span><span>select / multi-select dots</span>
      <span class="k">drag empty space</span><span>pan · shift+drag: region select · space+drag: pan anywhere</span>
      <span class="k">wheel</span><span>zoom (0.5×–8×)</span>
      <span class="k">0 / f</span><span>reset zoom · fit all</span>
      <span class="k">⌘E</span><span>edit focused fact</span>
      <span class="k">⌘R / R</span><span>reason workbench</span>
      <span class="k">⌘F / F</span><span>find fact by content</span>
      <span class="k">esc</span><span>clear selection / close modal</span>
      <span class="k">trust sparkline</span><span>click it (status bar) → trust lens: view facts above/below a threshold</span>
      <span class="k">?</span><span>this manual</span>
    </div>
    ${legendHtml()}
    ${glossaryHtml()}
    <div class="pane-hint">no toasts. the ripple, the stream line, the numerics — those are the
    success indicators. undo lives in the QUEUE tab and on every fact.</div>`, 700);
}
