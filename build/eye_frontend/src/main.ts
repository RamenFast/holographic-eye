/* The Holographic Eye — boot, status bar, keyboard, event routing.
   Compiled from PLAN.md. GPLv3 — see LICENSE. */

import { rpc, stats, openEvents, resetToken } from "./api";
import { store, Fact, EyeEvent, fid, initTheme } from "./state";
import { Field, escapeHtml } from "./field";
import { Stream, describe } from "./stream";
import { LeftColumn, Inspect, clearEntityHighlight, clearEntityHighlights } from "./panes";
import { initGarden } from "./garden";
import { setField, openWorkbench, openBackup, openHelp, openAskAgent,
         openSettings, applyUiPrefs } from "./modals";

const $ = (s: string) => document.querySelector<HTMLElement>(s)!;

let field: Field;
let reprojectTimer: number | undefined;
let knownFactIds = new Set<number>();
let projectionGeneration = 0;
let entityGeneration = 0;
let statsGeneration = 0;
let readSyncGeneration = 0;
let firstHelloSeen = false;
let bootComplete = false;
let closeFind: (() => void) | null = null;
let findGeneration = 0;

async function loadProjection(refit = false): Promise<void> {
  const generation = ++projectionGeneration;
  const res = await rpc("field.projection", refit ? { refit: true } : {});
  if (generation !== projectionGeneration) return;
  const facts: Fact[] = res.facts;
  const fresh = facts.filter((f) => !knownFactIds.has(f.fact_id) && knownFactIds.size > 0);
  store.setFacts(facts, res.meta);
  knownFactIds = new Set(facts.map((f) => f.fact_id));
  for (const f of fresh) field.arrival(store.facts.get(f.fact_id)!);
}

async function loadEntities(): Promise<void> {
  const generation = ++entityGeneration;
  const res = await rpc("entities.list", { limit: 2000 });
  if (generation !== entityGeneration) return;
  store.entities = res.entities;
  store.entityTotal = res.total;
  store.emit("entities");
}

async function refreshStats(): Promise<void> {
  const generation = ++statsGeneration;
  const next = await stats();
  if (generation !== statsGeneration) return;
  store.stats = next;
  renderStatusBar();
}

function renderStatusBar(): void {
  const s = store.stats;
  const hist: Record<string, number> = s.trust_histogram ?? {};
  const maxH = Math.max(1, ...Object.values(hist));
  let spark = "";
  for (let i = 0; i <= 10; i++) {
    const v = hist[(i / 10).toFixed(1)] ?? 0;
    const px = v ? Math.max(2, Math.round((Math.log(1 + v) / Math.log(1 + maxH)) * 12)) : 1;
    spark += `<i class="${v === maxH && v > 0 ? "hot" : ""}" style="height:${px}px" title="trust ${(i / 10).toFixed(1)}: ${v}"></i>`;
  }
  const snrWarn = (s.snr ?? 9) < 2.0
    ? ' <span class="warn" title="signal-to-noise √(dim/facts) below 2.0 — the holographic superposition is crowded; recall accuracy degrades as more facts are added">⚠</span>' : "";
  // age of the newest journal event: recent = live wire, old = merely quiet
  const lag = s.journal?.lag_s;
  const jl = lag === undefined ? ""
    : lag < 60 ? ` · journal <b>●</b>`
    : ` · journal quiet <b>${lag < 3600 ? `${Math.round(lag / 60)}m` : `${Math.round(lag / 3600)}h`}</b>`;
  const lens = store.trustLens;
  const lensBadge = lens.mode === "off" ? ""
    : ` <span class="lens-badge">🔍 ${lens.mode === "above" ? "≥" : "<"} ${lens.value.toFixed(2)}</span>`;
  const lensMark = lens.mode === "off" ? "" :
    `<i class="lens-mark" style="left:${lens.value * 100}%"></i>`;
  $("#sb-metrics").innerHTML =
    `<b>${s.facts ?? "…"}</b> facts · <b>${s.entities ?? "…"}</b> entities · ` +
    `trust <span class="spark lens-target" id="spark" title="click: trust lens — view facts above/below a threshold">${spark}${lensMark}</span>${lensBadge}` +
    ` · SNR <b>${s.snr ?? "…"}</b>${snrWarn}` + jl;
  $("#spark").onclick = openTrustLens;
  const dot = $("#sb-live");
  dot.className = `live-dot ${store.wsStatus}`;
  $("#sb-livelabel").textContent = store.wsStatus;
}

async function refreshReadModel(): Promise<void> {
  await Promise.all([loadProjection(), loadEntities(), refreshStats()]);
  store.emit("selection");
}

async function resyncReadState(initial: boolean): Promise<void> {
  const generation = ++readSyncGeneration;
  const knownEventId = store.events[store.events.length - 1]?.event_id ?? 0;
  await refreshReadModel();
  if (generation !== readSyncGeneration) return;
  const lastEventId = Number(store.stats.journal?.last_event_id ?? 0);
  const sinceId = initial
    ? Math.max(0, lastEventId - 120)
    : Math.max(knownEventId, Math.max(0, lastEventId - 400));
  const tail = await rpc("journal.tail", {
    limit: initial ? 120 : 400,
    newest_first: false,
    since_id: sinceId,
  });
  if (generation !== readSyncGeneration) return;
  store.pushEvents(Array.isArray(tail.events) ? tail.events : []);
}

function hideReadError(): void {
  $("#boot-error").hidden = true;
}

function showReadError(title: string, errorValue: unknown,
                       retry: () => Promise<void>): void {
  const error = $("#boot-error");
  error.querySelector<HTMLElement>("h1")!.textContent = title;
  $("#boot-error-message").textContent = String((errorValue as any)?.message ?? errorValue);
  error.hidden = false;
  store.wsStatus = "degraded";
  renderStatusBar();
  $("#sb-glyph").classList.remove("pulsing");
  const button = $("#boot-retry") as HTMLButtonElement;
  button.disabled = false;
  button.textContent = "Retry";
  button.onclick = async () => {
    button.disabled = true;
    button.textContent = "Retrying…";
    try {
      await retry();
      hideReadError();
    } catch (nextError) {
      showReadError(title, nextError, retry);
    }
  };
}

/* trust lens popover (feedback #4): drag a threshold, view above/below.
   Spark click is a true toggle (r2 #6 — the old outside-click check compared
   e.target.id to "spark", which the sparkline's child <i> bars broke: the
   popover dismissed on mousedown, then the click reopened it). The dismiss
   listener is removed on every close path — no accumulation. */
let closeTrustLens: (() => void) | null = null;
function openTrustLens(): void {
  if (closeTrustLens) { closeTrustLens(); return; }
  const lens = store.trustLens;
  const el = document.createElement("div");
  el.className = "lens-pop";
  el.innerHTML = `
    <div class="lens-row">
      <button class="btn lens-step" id="lens-minus">−</button>
      <input type="range" id="lens-slider" min="0" max="1" step="0.05" value="${lens.value}">
      <button class="btn lens-step" id="lens-plus">+</button>
      <span class="v" id="lens-val">${lens.value.toFixed(2)}</span>
    </div>
    <div class="lens-row lens-modes">
      <button class="btn" data-m="above">🔍 show ≥</button>
      <button class="btn" data-m="below">🔍 show &lt;</button>
      <button class="btn" data-m="off">off</button>
    </div>
    <div class="lens-hint">facts failing the filter fade in the field · gold line in Inspect = min_trust ${store.stats.min_trust ?? 0.3}</div>`;
  document.body.appendChild(el);
  const dismiss = (e: MouseEvent) => {
    const t = e.target as HTMLElement;
    if (!el.contains(t) && !t.closest("#spark")) closeTrustLens?.();
  };
  closeTrustLens = () => {
    el.remove();
    removeEventListener("mousedown", dismiss);
    closeTrustLens = null;
  };
  addEventListener("mousedown", dismiss);

  const slider = el.querySelector<HTMLInputElement>("#lens-slider")!;
  const val = el.querySelector<HTMLElement>("#lens-val")!;
  const syncModes = () => {
    el.querySelectorAll<HTMLElement>("[data-m]").forEach((b) =>
      b.classList.toggle("commit", b.dataset.m === store.trustLens.mode));
  };
  const apply = (v: number, mode = store.trustLens.mode) => {
    store.trustLens = { mode, value: Math.max(0, Math.min(1, v)) };
    slider.value = String(store.trustLens.value);
    val.textContent = store.trustLens.value.toFixed(2);
    syncModes();
    store.emit("trustlens"); // status bar + field both listen
  };
  slider.oninput = () =>
    apply(Number(slider.value),
          store.trustLens.mode === "off" ? "above" : store.trustLens.mode);
  el.querySelector<HTMLElement>("#lens-minus")!.onclick = () =>
    apply(store.trustLens.value - 0.05,
          store.trustLens.mode === "off" ? "above" : store.trustLens.mode);
  el.querySelector<HTMLElement>("#lens-plus")!.onclick = () =>
    apply(store.trustLens.value + 0.05,
          store.trustLens.mode === "off" ? "above" : store.trustLens.mode);
  el.querySelectorAll<HTMLElement>("[data-m]").forEach((b) => {
    b.onclick = () => apply(store.trustLens.value, b.dataset.m as any);
  });
  syncModes();
}

function onJournalEvent(ev: EyeEvent): void {
  store.pushEvent(ev);
  const mutating = ["add", "update", "remove", "helpful", "unhelpful", "extract",
                    "fact.add", "fact.update", "fact.remove", "fact.trust_set",
                    "entity.merge", "entity.alias", "entity.remove",
                    "backfill_vectors", "undo"].includes(ev.kind);
  if (mutating) {
    // bank pulse for the affected category, then debounced reprojection
    try {
      const img = JSON.parse(ev.after || ev.before || "{}");
      const cat = img.facts?.[0]?.category;
      if (cat) field.bankPulse(cat);
    } catch { /* no image */ }
    clearTimeout(reprojectTimer);
    reprojectTimer = window.setTimeout(() => {
      void refreshReadModel().catch((error) => {
        showReadError("The Eye could not refresh this change", error, refreshReadModel);
      });
    }, 400);
  }
  // trust flash comes free via reprojection (saturation re-render)
}

function findOverlay(): void {
  closeFind?.();
  const generation = ++findGeneration;
  const el = document.createElement("div");
  el.className = "find-overlay";
  el.innerHTML = `<input placeholder="find fact by content…"><div class="find-results"></div>`;
  document.body.appendChild(el);
  const input = el.querySelector("input")!;
  const results = el.querySelector<HTMLElement>(".find-results")!;
  let activeIndex = -1;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  results.setAttribute("role", "listbox");
  input.focus();
  // click-away dismiss that survives clicks INSIDE the overlay (the
  // old {once:true} listener disarmed itself on the first inner click)
  const close = () => {
    el.remove();
    removeEventListener("mousedown", onDocDown);
    if (closeFind === close) closeFind = null;
  };
  closeFind = close;
  function onDocDown(e: MouseEvent): void {
    if (!el.contains(e.target as Node)) close();
  }
  addEventListener("mousedown", onDocDown);
  const choose = (row: HTMLElement) => {
    store.select([Number(row.dataset.id)]);
    close();
  };
  const syncActive = () => {
    const rows = [...results.querySelectorAll<HTMLElement>("[data-id]")];
    rows.forEach((row, index) => {
      const active = index === activeIndex;
      row.classList.toggle("active", active);
      row.setAttribute("aria-selected", String(active));
    });
    const active = rows[activeIndex];
    if (active) {
      input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  input.onkeydown = (e) => {
    const rows = [...results.querySelectorAll<HTMLElement>("[data-id]")];
    if (e.key === "Escape") { close(); return; }
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && rows.length) {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      activeIndex = (activeIndex + step + rows.length) % rows.length;
      syncActive();
      return;
    }
    if (e.key === "Enter" && activeIndex >= 0 && rows[activeIndex]) {
      e.preventDefault();
      choose(rows[activeIndex]);
    }
  };
  input.oninput = () => {
    const q = input.value.toLowerCase();
    activeIndex = -1;
    if (q.length < 2) {
      results.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      return;
    }
    const hits = [...store.facts.values()]
      .filter((f) => f.content.toLowerCase().includes(q))
      .sort((a, b) => a.fact_id - b.fact_id).slice(0, 12);
    results.innerHTML = hits.map((f) =>
      `<div id="find-option-${generation}-${f.fact_id}" role="option" aria-selected="false" data-id="${f.fact_id}"><b>${fid(f.fact_id)}</b> ${escapeHtml(f.content.slice(0, 90))}</div>`).join("");
    input.setAttribute("aria-expanded", String(hits.length > 0));
    results.querySelectorAll<HTMLElement>("[data-id]").forEach((row) => {
      row.onclick = () => choose(row);
    });
  };
}

function renderContextRail(): void {
  const rail = $("#context-rail");
  const entities = [...store.highlightedEntities.keys()];
  const lens = store.trustLens;
  const items = entities.map((name, index) =>
    `<li><span>entity › ${escapeHtml(name)}</span><button type="button" data-entity="${index}" ` +
    `aria-label="Clear entity context ${escapeHtml(name)}" title="Clear ${escapeHtml(name)}">×</button></li>`);
  if (lens.mode !== "off") {
    items.push(`<li><span>trust › ${lens.mode === "above" ? "≥" : "&lt;"} ${lens.value.toFixed(2)}</span>` +
      `<button type="button" id="clear-trust-context" aria-label="Clear trust context" title="Clear trust lens">×</button></li>`);
  }
  rail.hidden = items.length === 0;
  rail.innerHTML = items.length ? `<ol>${items.join("")}</ol>` : "";
  rail.querySelectorAll<HTMLButtonElement>("[data-entity]").forEach((button) => {
    button.onclick = () => clearEntityHighlight(entities[Number(button.dataset.entity)]);
  });
  rail.querySelector<HTMLButtonElement>("#clear-trust-context")?.addEventListener("click", () => {
    store.trustLens = { ...store.trustLens, mode: "off" };
    store.emit("trustlens");
  });
}

function renderStreamGlance(): void {
  const glance = $("#stream-glance");
  const ev = store.events[store.events.length - 1];
  if (!ev) { glance.textContent = "waiting for journal events"; return; }
  const line = describe(ev);
  glance.textContent = `${line.action} · ${line.detail}`;
}

function initStreamDock(): void {
  const dock = $("#stream-dock");
  const toggle = $("#stream-toggle") as HTMLButtonElement;
  let expanded = document.documentElement.dataset.stream === "expanded";
  const apply = () => {
    dock.classList.toggle("expanded", expanded);
    document.documentElement.dataset.stream = expanded ? "expanded" : "collapsed";
    toggle.setAttribute("aria-expanded", String(expanded));
    toggle.querySelector<HTMLElement>(".stream-toggle-state")!.textContent = expanded ? "collapse" : "expand";
    toggle.querySelector<HTMLElement>("b")!.textContent = expanded ? "⌄" : "⌃";
  };
  toggle.onclick = () => {
    expanded = !expanded;
    try { localStorage.setItem("eyeStreamExpanded", String(expanded)); } catch { /* private mode */ }
    apply();
  };
  apply();
}

function altHistoryBlocked(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  if (el?.closest("input, textarea, select, button, [contenteditable]:not([contenteditable='false'])")) return true;
  return Boolean(document.querySelector(".modal-back, .find-overlay, .lens-pop, .ctxmenu"));
}

function bindKeys(): void {
  addEventListener("keydown", (e) => {
    if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey &&
        (e.key === "ArrowLeft" || e.key === "ArrowRight") && !altHistoryBlocked(e.target)) {
      const moved = store.navigateSelectionHistory(e.key === "ArrowLeft" ? -1 : 1);
      if (moved) e.preventDefault();
      return;
    }
    const inInput = ["INPUT", "TEXTAREA", "SELECT"].includes((e.target as HTMLElement).tagName) ||
      (e.target as HTMLElement).isContentEditable;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "r" && !e.shiftKey) {
      e.preventDefault(); openWorkbench(); return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault(); findOverlay(); return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "e") {
      e.preventDefault();
      $("#pane-inspect").querySelector<HTMLElement>("#edit-content")?.click();
      return;
    }
    if (inInput) return;
    if (e.key === "?") openHelp();
    if (e.key === "F") {
      // preventDefault or the opening "F" lands in the focused input
      // and every search silently becomes "F…" (caught by break-test)
      e.preventDefault();
      findOverlay();
    }
    if (e.key === "R") {
      const f = store.focusedFact ? store.facts.get(store.focusedFact) : null;
      openWorkbench(f?.entities.slice(0, 2) ?? []);
    }
    if (e.key === "Escape" && !document.querySelector(".modal-back")) {
      store.clearSelection();
      clearEntityHighlights();
    }
  });
}

async function boot(): Promise<void> {
  initTheme();    // mirror the pre-paint theme stamp into the token bridge
  applyUiPrefs(); // persisted text size + garden toggle, before first paint
  initStreamDock();
  field = new Field($("#field-wrap"));
  setField(field);
  new Stream($("#stream"));
  new LeftColumn($("#pane-left"));
  new Inspect($("#pane-inspect"));
  initGarden();   // after prefs: respects body.no-garden

  (window as any).eyeRefresh = async () => {
    try {
      await refreshReadModel();
      hideReadError();
    } catch (error) {
      showReadError("The Eye could not refresh its read model", error, refreshReadModel);
    }
  };
  (window as any).eyeAskAgent = (sel: number[]) => openAskAgent(sel);
  (window as any).eyeRefit = async () => {
    try { await loadProjection(true); field.fit(); }
    catch (error) {
      showReadError("The Eye could not refit the Field", error,
        async () => { await loadProjection(true); field.fit(); });
    }
  };
  (window as any).eyeResetToken = () => resetToken();
  (window as any).eyeField = field;

  $("#sb-workbench").onclick = () => openWorkbench();
  $("#sb-backup").onclick = () => openBackup();
  $("#sb-help").onclick = () => openHelp();
  $("#sb-settings").onclick = () => openSettings();
  $("#sb-ask").onclick = () =>
    openAskAgent([...store.selection].length ? [...store.selection] : []);
  store.on("trustlens", () => { renderStatusBar(); renderContextRail(); });
  store.on("entities", renderContextRail);
  store.on("events", renderStreamGlance);
  renderContextRail();
  renderStreamGlance();

  openEvents(onJournalEvent, (helloStats) => {
    const reconnect = firstHelloSeen || bootComplete;
    firstHelloSeen = true;
    statsGeneration++;
    store.stats = helloStats;
    renderStatusBar();
    if (reconnect) {
      void resyncReadState(false).then(hideReadError).catch((error) => {
        showReadError("The Eye could not recover missed updates", error,
          async () => { await resyncReadState(false); });
      });
    }
  }, (status) => {
    store.wsStatus = status; renderStatusBar();
    $("#sb-glyph").classList.toggle("pulsing", status === "live");
  });

  bindKeys();
  await resyncReadState(true);
  bootComplete = true;
  setInterval(() => { void refreshStats().catch(() => { /* status keeps the last good reading */ }); }, 15000);
}

boot().catch((error) => {
  showReadError("The Eye could not attach", error,
    async () => { location.reload(); });
});
