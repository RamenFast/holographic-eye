/* One editor, two explicit save actions. GPLv3, see LICENSE. */
import { rpc } from "./api";
import { store, fid } from "./state";
import { escapeHtml } from "./field";
import { modal, closeModal, modalIsOpen } from "./modals";
import { MemoryDraft, checkedFact, DETAIL_KEYS, DetailKey } from "./memory-editor-model";

const drafts = new Map<number, MemoryDraft>();
let editorSurface: HTMLElement | null = null;
let pageProtected = false;
let exitDecision: { promise: Promise<boolean>; host: HTMLElement | null;
  finish: (exit: boolean, closeHost?: boolean) => void } | null = null;

function riskyDrafts(): MemoryDraft[] { return [...drafts.values()].filter(draft => draft.exitRisk); }

function preventPageExit(event: BeforeUnloadEvent): void {
  if (!riskyDrafts().length) return;
  event.preventDefault();
  event.returnValue = "";
}

function showReloadNotice(): void {
  if (exitDecision) {
    exitDecision.host?.querySelector<HTMLElement>("#me-exit-keep")?.focus();
    return;
  }
  const show = () => {
    if (!editorSurface || !modalIsOpen(editorSurface)) return;
    let notice = editorSurface.querySelector<HTMLElement>("#me-reload-notice");
    if (!notice) {
      notice = document.createElement("p");
      notice.id = "me-reload-notice";
      notice.setAttribute("role", "status");
      notice.tabIndex = -1;
      editorSurface.querySelector(".memory-editor")!.prepend(notice);
    }
    notice.textContent = "Reload stopped to keep your drafts and save outcomes. Save or explicitly discard drafts before reloading. Unresolved saves need inspection first.";
    notice.focus();
  };
  if (editorSurface && modalIsOpen(editorSurface)) { show(); return; }
  const first = riskyDrafts()[0];
  if (first) void openMemoryEditor(first.id).then(show);
}

function preventReloadKey(event: KeyboardEvent): void {
  if (!riskyDrafts().length) return;
  if (event.key !== "F5" && !((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r")) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  showReloadNotice();
}

function syncPageProtection(): void {
  const protect = riskyDrafts().length > 0;
  if (protect !== pageProtected) {
    pageProtected = protect;
    if (protect) {
      window.addEventListener("beforeunload", preventPageExit);
      window.addEventListener("keydown", preventReloadKey, true);
    } else {
      window.removeEventListener("beforeunload", preventPageExit);
      window.removeEventListener("keydown", preventReloadKey, true);
    }
  }
  refreshExitDecision();
}

function refreshExitDecision(): void {
  const panel = exitDecision?.host?.querySelector<HTMLElement>("#me-exit-decision");
  if (!panel) return;
  const risks = riskyDrafts();
  panel.querySelector<HTMLElement>("#me-exit-list")!.textContent = risks.map(draft =>
    `${fid(draft.id)}: ${draft.writing ? "save still running" : draft.unknown ? "save outcome unknown" : "unsaved draft"}`).join(" · ");
  const unresolved = risks.some(draft => draft.writing || draft.unknown);
  panel.querySelector<HTMLElement>("#me-exit-guidance")!.textContent = unresolved
    ? "A save can still complete after you exit. Exiting does not undo it. Drafts and this page's retry protection will be lost. Keep the app open to inspect the saved state and journal."
    : "Exiting discards all unsaved drafts listed here. Saved memory and journal receipts stay unchanged. Keep the app open to save or review your drafts.";
  panel.querySelector<HTMLElement>("#me-exit-confirm")!.textContent = unresolved
    ? "Exit app with unresolved saves" : "Exit app and discard unsaved drafts";
}

/** The native shell awaits this decision before closing its window. */
export function requestMemoryEditorExit(): Promise<boolean> {
  if (exitDecision) return exitDecision.promise;
  if (!riskyDrafts().length) return Promise.resolve(true);
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>(done => { resolve = done; });
  let settled = false;
  let standalone = false;
  let host: HTMLElement | null = null;
  const priorFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const finish = (exit: boolean, closeHost = true) => {
    if (settled) return;
    settled = true;
    exitDecision = null;
    host?.querySelector("#me-exit-decision")?.remove();
    if (!standalone && host) {
      for (const element of host.querySelectorAll<HTMLElement>("#me-form, #me-leave")) element.inert = false;
    }
    if (standalone && closeHost && host) closeModal(host);
    if (!exit && priorFocus && document.contains(priorFocus)) priorFocus.focus({ preventScroll: true });
    resolve(exit);
  };
  exitDecision = { promise, host: null, finish };
  const body = `<section id="me-exit-decision" class="memory-editor me-exit-decision" aria-labelledby="me-exit-heading">
    <h2 id="me-exit-heading">Close the app?</h2>
    <p id="me-exit-list"></p><p id="me-exit-guidance" role="status"></p>
    <div class="m-actions"><button type="button" class="btn" id="me-exit-keep">Keep app open</button>
      <button type="button" class="btn del" id="me-exit-confirm">Exit app and discard unsaved drafts</button></div>
  </section>`;
  if (editorSurface && modalIsOpen(editorSurface)) {
    host = editorSurface;
    const section = document.createElement("div");
    section.innerHTML = body;
    host.querySelector(".memory-editor")!.prepend(section.firstElementChild!);
    for (const element of host.querySelectorAll<HTMLElement>("#me-form, #me-leave")) element.inert = true;
  } else {
    standalone = true;
    host = modal("Close app · memory drafts", body, 660, {
      preserveReasonHalo: true,
      beforeClose: () => { finish(false, false); return true; },
    });
  }
  if (!host) { finish(false); return promise; }
  exitDecision!.host = host;
  host.addEventListener("eye:close", () => finish(false, false), { once: true });
  host.querySelector<HTMLElement>("#me-exit-keep")!.onclick = () => finish(false);
  host.querySelector<HTMLElement>("#me-exit-confirm")!.onclick = () => finish(true);
  refreshExitDecision();
  host.querySelector<HTMLElement>("#me-exit-keep")!.focus();
  return promise;
}


export async function openMemoryEditor(id: number): Promise<void> {
  let draft = drafts.get(id);
  let allowClose = false;
  const back = modal(`Edit memory · ${fid(id)}`, `
    <div class="memory-editor">
      <p id="me-loading" role="status">Loading saved memory…</p>
      <div id="me-form" hidden></div>
      <div id="me-leave" hidden role="status">
        <p id="me-leave-message"></p>
        <div class="m-actions">
          <button type="button" class="btn" id="me-stay">Keep editing</button>
          <button type="button" class="btn" id="me-keep">Close and keep draft</button>
          <button type="button" class="btn del" id="me-discard">Discard draft and close</button>
        </div>
      </div>
    </div>`, 820, {
    preserveReasonHalo: true,
    beforeClose: () => {
      if (exitDecision?.host === back) { exitDecision.finish(false); return false; }
      if (allowClose || !draft || (!draft.busy && !draft.dirty && !draft.unknown)) return true;
      if (!back) return false;
      const message = back.querySelector<HTMLElement>("#me-leave-message")!;
      message.textContent = draft.busy ? "An editor request is still running. Wait for its result before closing."
        : draft.unknown ? "The save outcome is unresolved. Keep this blocked draft when closing."
        : "This memory has unsaved changes. Keep the draft, or discard it explicitly.";
      back.querySelector<HTMLElement>("#me-leave")!.hidden = false;
      back.querySelector<HTMLButtonElement>("#me-keep")!.disabled = draft.busy;
      back.querySelector<HTMLButtonElement>("#me-discard")!.disabled = draft.busy || draft.unknown;
      back.querySelector<HTMLButtonElement>("#me-stay")!.focus();
      return false;
    },
  });
  if (!back) return;
  editorSurface = back;
  back.addEventListener("eye:close", () => {
    if (editorSurface === back) editorSurface = null;
    syncPageProtection();
  }, { once: true });
  const q = <T extends HTMLElement = HTMLElement>(selector: string) => back.querySelector<T>(selector)!;
  q("#me-stay").onclick = () => { q("#me-leave").hidden = true; q<HTMLTextAreaElement>("#me-content")?.focus(); };
  q("#me-keep").onclick = () => { if (draft?.busy) return; allowClose = true; closeModal(back); };
  q("#me-discard").onclick = () => {
    if (draft?.busy || draft?.unknown) return;
    drafts.delete(id); syncPageProtection(); allowClose = true; closeModal(back);
  };
  try {
    if (!draft || (!draft.dirty && !draft.unknown && !draft.busy)) {
      const fresh = checkedFact((await rpc("fact.get", { fact_id: id })).fact, id);
      if (!modalIsOpen(back)) return;
      const receipts = draft?.receipts ?? [];
      draft = new MemoryDraft(fresh);
      draft.receipts = receipts;
      drafts.set(id, draft);
    }
  } catch (error: any) {
    if (modalIsOpen(back)) q("#me-loading").textContent = String(error?.message ?? error);
    return;
  }
  if (!modalIsOpen(back) || !draft) return;
  const d = draft;
  q("#me-loading").hidden = true;
  const categories = [...new Set([d.base.category, ...Object.keys(store.stats.categories ?? {})])].sort();
  q("#me-form").innerHTML = `
    <p class="dim">Drafts stay in this app page across view refreshes and editor closes. Reload and app-close guards help prevent accidental loss. Drafts are not saved to disk.</p>
    <section class="me-section" aria-labelledby="me-content-heading">
      <h2 id="me-content-heading">Content</h2>
      <label for="me-content">Memory text</label>
      <textarea id="me-content" class="edit-ta" rows="7" aria-describedby="me-content-error me-trim"></textarea>
      <p class="me-error" id="me-content-error"></p>
      <p class="dim" id="me-trim">Save trims spaces at the start and end of memory text. Line breaks inside the text stay intact.</p>
    </section>
    <section class="me-section" aria-labelledby="me-metadata-heading">
      <h2 id="me-metadata-heading">Metadata</h2>
      <div class="me-fields">
        <div><label for="me-category">Category</label>
          <input id="me-category" list="me-categories" aria-describedby="me-category-error">
          <datalist id="me-categories">${categories.map(c => `<option value="${escapeHtml(c)}"></option>`).join("")}</datalist>
          <p class="me-error" id="me-category-error"></p></div>
        <div><label for="me-tags">Tags · comma-separated</label>
          <input id="me-tags" aria-describedby="me-tags-help">
          <p class="dim" id="me-tags-help">Leave empty to clear tags.</p></div>
      </div>
    </section>
    <section class="me-section" aria-labelledby="me-preview-heading">
      <h2 id="me-preview-heading">Detail changes</h2>
      <div id="me-preview-body"><p class="dim">Preview changes to memory text, category, and tags before saving.</p></div>
      <div class="m-actions">
        <button type="button" class="btn" id="me-preview">Preview changes</button>
        <button type="button" class="btn commit" id="me-save">Save details</button>
      </div>
    </section>
    <section class="me-section" aria-labelledby="me-trust-heading">
      <h2 id="me-trust-heading">Fact trust</h2>
      <p class="dim">Trust saves separately from details. Moving the slider does not write memory.</p>
      <div class="me-trust-fields">
        <label for="me-trust">Draft trust</label>
        <input id="me-trust" type="number" min="0" max="1" step="any" aria-describedby="me-trust-error">
        <input id="me-trust-slider" type="range" min="0" max="1" step="0.01" aria-label="Draft fact trust slider">
        <button type="button" class="btn" id="me-set-trust">Set trust</button>
      </div>
      <p class="me-error" id="me-trust-error"></p>
      <p class="dim">Set trust changes the score, not the helpful count. Helpful feedback stays in Inspect.</p>
    </section>
    <section class="me-section" aria-labelledby="me-saved-heading">
      <h2 id="me-saved-heading">Saved state and receipts</h2>
      <p id="me-status" role="status" aria-live="polite"></p>
      <p class="dim">We check saved values before writing. This frontend check is not a server lock. Another writer can still change memory between requests.</p>
      <p class="dim">One detail save is one journal event, not an all-or-nothing transaction across memory and its journal.</p>
      <div id="me-receipts"></div>
      <div class="m-actions"><button type="button" class="btn" id="me-current">Inspect current saved state</button></div>
      <details id="me-current-details"><summary>Compare the last fetched saved state</summary>
        <div id="me-current-values"></div>
        <div class="m-actions">
          <button type="button" class="btn" id="me-use-details">Discard detail draft and use displayed saved details</button>
          <button type="button" class="btn" id="me-use-trust">Discard trust draft and use displayed saved trust</button>
        </div>
      </details>
      <details><summary>Advanced · read-only evidence</summary><div id="me-evidence"></div></details>
    </section>
    <div class="m-actions"><button type="button" class="btn" id="me-close">Close editor</button></div>`;
  q("#me-form").hidden = false;

  function fillInputs(): void {
    for (const key of DETAIL_KEYS) q<HTMLInputElement>(`#me-${key}`).value = d.values[key];
    q<HTMLInputElement>("#me-trust").value = d.trustText;
    if (!d.errors.trust) q<HTMLInputElement>("#me-trust-slider").value = d.trustText;
  }
  function previewMarkup(): string {
    if (!d.previewReady) return '<p class="dim">Preview changes to memory text, category, and tags before saving.</p>';
    const p = d.preview;
    return DETAIL_KEYS.filter(key => key in d.patch).map(key => `
      <h3>${key === "content" ? "Memory text" : key === "category" ? "Category" : "Tags"}</h3>
      <div class="me-diff"><div><h4>Before</h4><pre>${escapeHtml(p.before[key]) || "(empty)"}</pre></div>
        <div><h4>After</h4><pre>${escapeHtml(p.after[key]) || "(empty)"}</pre></div></div>`).join("") +
      `<p>Predicted entities: ${escapeHtml(p.predicted_entities.map((e: any) => `${String(e?.name ?? "?")}${e?.exists ? "" : " (new)"}`).join(", ") || "none")}</p>
      <p>Removed links: ${escapeHtml(p.entities_removed.map(String).join(", ") || "none")}</p>
      <p>Category bank rebuilds: ${escapeHtml(p.bank_impact.map((b: any) => `${String(b?.bank ?? "?")} (${String(b?.fact_count ?? "?")} category facts)`).join(", "))}</p>
      <p class="dim">Predictions use current provider state. Category counts can include facts without vectors. This is not a preview of future recall rankings.</p>`;
  }
  function update(): void {
    syncPageProtection();
    if (!modalIsOpen(back!)) return;
    const blocked = d.busy || d.unknown;
    for (const key of DETAIL_KEYS) q<HTMLInputElement>(`#me-${key}`).disabled = d.busy;
    q<HTMLInputElement>("#me-trust").disabled = d.busy;
    q<HTMLInputElement>("#me-trust-slider").disabled = d.busy;
    for (const key of ["content", "category", "trust"]) {
      q(`#me-${key}-error`).textContent = d.errors[key] ?? "";
      q(`#me-${key}`).setAttribute("aria-invalid", String(!!d.errors[key]));
    }
    q<HTMLButtonElement>("#me-preview").disabled = blocked || !d.detailsDirty || !!d.errors.content || !!d.errors.category;
    q<HTMLButtonElement>("#me-save").disabled = blocked || !d.previewReady || !d.detailsDirty;
    q<HTMLButtonElement>("#me-set-trust").disabled = blocked || !d.trustDirty || !!d.errors.trust;
    q<HTMLButtonElement>("#me-current").disabled = d.busy;
    q<HTMLButtonElement>("#me-use-details").disabled = blocked;
    q<HTMLButtonElement>("#me-use-trust").disabled = blocked;
    q<HTMLButtonElement>("#me-keep").disabled = d.busy;
    q<HTMLButtonElement>("#me-discard").disabled = blocked;
    q("#me-status").textContent = d.unknown ? `Writes blocked. ${d.status}` : d.status;
    q("#me-preview-body").innerHTML = previewMarkup();
    q("#me-current-values").innerHTML = `<p>Fact trust: ${escapeHtml(String(d.current.trust_score))}</p>` +
      DETAIL_KEYS.map(key => `<h3>${key}</h3><pre>${escapeHtml(d.current[key]) || "(empty)"}</pre>`).join("");
    if (d.conflicts.length || d.unknown) q<HTMLDetailsElement>("#me-current-details").open = true;
    const technical = { fact_id: d.current.fact_id, created_at: d.current.created_at, updated_at: d.current.updated_at,
      stored_retrieval_count: d.current.retrieval_count, journal_observed_retrievals: d.current.journal_retrievals,
      helpful_count: d.current.helpful_count, links: d.current.links, vector_bytes: d.current.vector_bytes,
      ...(Object.prototype.hasOwnProperty.call(d.current, "register") ? { register: d.current.register } : {}) };
    q("#me-evidence").innerHTML = `${d.evidenceStale ? '<p role="status">Technical evidence is stale. Inspect current saved state to refresh these measurements.</p>' : ''}<pre>${escapeHtml(JSON.stringify(technical, null, 2))}</pre>`;
    q("#me-receipts").innerHTML = d.receipts.map(r => `<details><summary>${escapeHtml(r.action)} · journal #${r.event_id}</summary>
      <button type="button" class="btn me-receipt" data-event="${r.event_id}">Read journal receipt</button><pre class="me-receipt-body"></pre></details>`).join("");
    q("#me-receipts").querySelectorAll<HTMLButtonElement>(".me-receipt").forEach(button => {
      button.onclick = async () => {
        button.disabled = true;
        const target = button.nextElementSibling as HTMLElement;
        try { target.textContent = JSON.stringify((await rpc("journal.get", { event_id: Number(button.dataset.event) })).event, null, 2); }
        catch (error: any) { target.textContent = String(error?.message ?? error); button.disabled = false; }
      };
    });
  }
  async function run(action: () => Promise<void>, refresh = false): Promise<void> {
    const receiptsBefore = d.receipts.length;
    try { const pending = action(); update(); await pending; }
    catch (error: any) { d.status = String(error?.message ?? error); }
    if (modalIsOpen(back!)) { fillInputs(); update(); }
    if (refresh && d.receipts.length > receiptsBefore) {
      try { await (window as any).eyeRefresh?.(); }
      catch { d.status += " The view refresh failed. Use Inspect current saved state."; update(); }
    }
  }
  for (const key of DETAIL_KEYS) q<HTMLInputElement>(`#me-${key}`).oninput = event => {
    d.change(key as DetailKey, (event.target as HTMLInputElement).value); update();
  };
  q<HTMLInputElement>("#me-trust").oninput = event => {
    d.trustText = (event.target as HTMLInputElement).value;
    if (!d.errors.trust) q<HTMLInputElement>("#me-trust-slider").value = d.trustText;
    update();
  };
  q<HTMLInputElement>("#me-trust-slider").oninput = event => {
    d.trustText = (event.target as HTMLInputElement).value;
    q<HTMLInputElement>("#me-trust").value = d.trustText; update();
  };
  q("#me-preview").onclick = () => void run(() => d.loadPreview(rpc));
  q("#me-save").onclick = () => void run(() => d.saveDetails(rpc), true);
  q("#me-set-trust").onclick = () => void run(() => d.setTrust(rpc), true);
  q("#me-current").onclick = () => void run(() => d.inspectCurrent(rpc));
  q("#me-use-details").onclick = () => { d.useCurrentDetails(); fillInputs(); update(); };
  q("#me-use-trust").onclick = () => { d.useCurrentTrust(); fillInputs(); update(); };
  q("#me-close").onclick = () => { closeModal(back); };
  q("#me-content").onkeydown = event => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      if (!q<HTMLButtonElement>("#me-preview").disabled) void run(() => d.loadPreview(rpc));
    }
  };
  fillInputs(); update(); q<HTMLTextAreaElement>("#me-content").focus();
}
