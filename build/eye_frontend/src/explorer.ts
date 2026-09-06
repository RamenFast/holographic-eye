import { store, fid } from "./state";
import { categoryGroups, categoryKey, categoryLabel, categoryToken, factDateLabel, filterFacts, indexFacts, paginate, timeGroups, type Filters, type IndexedFact, type TimeAxis } from "./explorer-data";
export type BrowserView = "categories" | "timeline";
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = "", id = ""): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag); el.textContent = text; if (id) el.id = id; return el;
}
function button(text: string, id: string, action: () => void): HTMLButtonElement {
  const el = node("button", text, id); el.type = "button"; el.addEventListener("click", action); return el;
}
export class MemoryExplorer {
  private mode: BrowserView = "categories";
  private active = false;
  private dirty = true;
  private index: IndexedFact[] = [];
  private filters: Filters = { query: "", category: null, branch: null, axis: "created_at" };
  private pages = { categories: { directory: 0, facts: 0, scroll: 0 }, timeline: { directory: 0, facts: 0, scroll: 0 } };
  private query = node("input", "", "browser-query");
  private category = node("input", "", "browser-category");
  private axis = node("select", "", "browser-axis");
  private coverage = node("p", "", "browser-coverage");
  private axisLabel = node("label");
  private dateHelp = node("details", "", "browser-date-help");
  private extraFilters = node("div", "", "browser-extra-filters");
  private filtersToggle: HTMLButtonElement;
  private clearAll: HTMLButtonElement;
  private facets = node("p", "", "browser-filters");
  private crumbs = node("nav", "", "browser-breadcrumbs");
  private directory = node("div", "", "browser-directory");
  private facts = node("div", "", "browser-facts");
  private directoryHeading = node("h3");
  private directoryPage = node("span");
  private factsPage = node("span");
  private prevDirectory: HTMLButtonElement;
  private nextDirectory: HTMLButtonElement;
  private prevFacts: HTMLButtonElement;
  private nextFacts: HTMLButtonElement;
  private summary = { loaded: 0, matched: 0, directoryTotal: 0, renderedDirectory: 0, renderedFacts: 0 };
  constructor(private host: HTMLElement) {
    host.classList.add("memory-explorer");
    const heading = node("h2", "Browse loaded facts", "browser-heading"); heading.tabIndex = -1;
    const controls = node("div"); controls.className = "browser-controls";
    this.query.type = "search"; this.query.placeholder = "Find content or fact ID";
    this.query.setAttribute("aria-label", "Find in loaded facts: content or fact ID");
    this.query.addEventListener("input", () => { this.filters.query = this.query.value; this.changed(); });
    this.extraFilters.hidden = true; this.extraFilters.className = "browser-extra-filters";
    this.filtersToggle = button("Filters", "browser-filters-toggle", () => {
      this.extraFilters.hidden = !this.extraFilters.hidden;
      this.filtersToggle.setAttribute("aria-expanded", String(!this.extraFilters.hidden));
    });
    this.filtersToggle.setAttribute("aria-expanded", "false");
    this.filtersToggle.setAttribute("aria-controls", "browser-extra-filters");
    this.clearAll = button("Clear all", "browser-clear-all", () => {
      this.filters.query = this.query.value = this.category.value = "";
      this.filters.category = null; this.filters.branch = null; this.changed();
    });
    this.clearAll.hidden = true;
    controls.append(this.query, this.filtersToggle, this.clearAll);
    this.category.type = "text"; this.category.placeholder = "Exact category, including spaces";
    const applyCategory = () => { this.filters.category = categoryKey(this.category.value); this.changed(); };
    this.category.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); applyCategory(); } });
    const categoryLabel = node("label", "Exact category"); categoryLabel.append(this.category);
    const exactControls = node("div"); exactControls.className = "browser-controls";
    exactControls.append(categoryLabel, button("Apply category", "browser-category-apply", applyCategory));
    for (const [value, text] of [["created_at", "Stored"], ["updated_at", "Last updated"]]) { const option = node("option", text); option.value = value; this.axis.append(option); }
    this.axis.addEventListener("change", () => { this.filters.axis = this.axis.value as TimeAxis; this.filters.branch = null; this.changed(); });
    this.axisLabel.textContent = "Time (UTC)"; this.axisLabel.className = "browser-axis-label";
    this.axisLabel.append(this.axis); controls.append(this.axisLabel);
    const clears = node("div"); clears.className = "browser-actions";
    clears.append(
      button("Clear query", "browser-clear-query", () => { this.query.value = this.filters.query = ""; this.changed(); }),
      button("All categories", "browser-clear-category", () => { this.filters.category = null; this.category.value = ""; this.changed(); }),
      button("All time", "browser-clear-time", () => { this.filters.branch = null; this.changed(); })
    );
    this.extraFilters.append(exactControls, clears);
    this.dateHelp.append(node("summary", "About these dates"),
      node("p", "Stored and Last updated describe metadata, not when events occurred. Naive timestamps use UTC. Invalid or missing dates are Unknown."));
    this.coverage.setAttribute("role", "status");
    this.crumbs.setAttribute("aria-label", "UTC time branch");
    this.directory.setAttribute("aria-label", "Browse groups");
    this.facts.setAttribute("aria-label", "Matching loaded facts");
    const navigate = (kind: "directory" | "facts", delta: number) => { this.pages[this.mode][kind] += delta; this.render(); };
    this.prevDirectory = button("Previous", "browser-directory-prev", () => navigate("directory", -1));
    this.nextDirectory = button("Next", "browser-directory-next", () => navigate("directory", 1));
    this.prevFacts = button("Previous", "browser-facts-prev", () => navigate("facts", -1));
    this.nextFacts = button("Next", "browser-facts-next", () => navigate("facts", 1));
    this.prevDirectory.setAttribute("aria-label", "Previous groups"); this.nextDirectory.setAttribute("aria-label", "Next groups");
    this.prevFacts.setAttribute("aria-label", "Previous facts"); this.nextFacts.setAttribute("aria-label", "Next facts");
    const directoryPager = node("div"), factPager = node("div");
    directoryPager.className = factPager.className = "browser-section-heading";
    directoryPager.append(this.directoryHeading, this.prevDirectory, this.directoryPage, this.nextDirectory);
    factPager.append(node("h3", "Matching facts"), this.prevFacts, this.factsPage, this.nextFacts);
    host.append(heading, controls, this.extraFilters, this.facets, this.coverage, this.dateHelp,
      this.crumbs, directoryPager, this.directory, factPager, this.facts);
    store.on("facts", () => { this.dirty = true; if (this.active) this.render(); });
    store.on("selection", () => this.markSelection());
  }
  setMode(view: BrowserView): void {
    if (view === this.mode) return;
    if (this.active) this.pages[this.mode].scroll = this.host.scrollTop;
    this.mode = view;
    if (this.active) this.render();
    this.host.scrollTop = this.pages[view].scroll;
  }
  setActive(active: boolean): void {
    if (!active && this.active) this.pages[this.mode].scroll = this.host.scrollTop;
    const entering = active && !this.active;
    this.active = active;
    if (active) { this.render(); if (entering) this.host.scrollTop = this.pages[this.mode].scroll; }
  }
  status() {
    return { mode: this.mode, active: this.active, ...this.summary, directoryPage: this.pages[this.mode].directory,
      factPage: this.pages[this.mode].facts, query: this.filters.query, category: this.filters.category,
      branch: this.filters.branch, axis: this.filters.axis };
  }
  private changed(): void {
    for (const state of Object.values(this.pages)) { state.directory = 0; state.facts = 0; }
    this.render();
  }
  private markSelection(): void {
    for (const el of this.facts.querySelectorAll<HTMLButtonElement>("[data-fact-id]"))
      el.setAttribute("aria-pressed", String(store.selection.has(Number(el.dataset.factId))));
  }
  private render(): void {
    if (!this.active) return;
    const focus = document.activeElement as HTMLElement | null;
    const focusKey = focus && this.host.contains(focus) ? focus.dataset.browserKey : undefined;
    const scroll = this.host.scrollTop;
    if (this.dirty) { this.index = indexFacts(store.facts.values()); this.dirty = false; }
    const rows = filterFacts(this.index, this.filters), state = this.pages[this.mode];
    const groups = this.mode === "categories"
      ? categoryGroups(rows).map(g => ({ key: g.token, label: categoryLabel(g.key), count: g.count, action: () => { this.filters.category = g.key; this.category.value = g.key.kind === "value" ? g.key.value : ""; this.changed(); } }))
      : timeGroups(rows, this.filters.axis, this.filters.branch).map(g => ({ key: g.branch, label: g.branch === "unknown" ? "Unknown" : g.branch, count: g.count, action: () => { this.filters.branch = g.branch; this.changed(); } }));
    const dg = paginate(groups, state.directory), fp = paginate(rows, state.facts);
    state.directory = dg.page; state.facts = fp.page;
    this.summary = { loaded: this.index.length, matched: rows.length, directoryTotal: dg.total, renderedDirectory: dg.items.length, renderedFacts: fp.items.length };
    this.coverage.textContent = `Loaded facts: ${this.index.length.toLocaleString()} · Matching: ${rows.length.toLocaleString()} · Loaded set only`;
    const activeFacets: string[] = [];
    if (this.filters.category !== null) activeFacets.push(`Category: ${categoryLabel(this.filters.category)}`);
    if (this.filters.branch !== null && this.mode !== "timeline") activeFacets.push(`${this.filters.axis === "created_at" ? "Stored" : "Last updated"}: ${this.filters.branch === "unknown" ? "Unknown" : this.filters.branch} UTC`);
    this.facets.textContent = activeFacets.join(" · "); this.facets.hidden = activeFacets.length === 0;
    this.clearAll.hidden = !this.filters.query && this.filters.category === null && this.filters.branch === null;
    this.axisLabel.hidden = this.mode !== "timeline"; this.dateHelp.hidden = this.mode !== "timeline";
    this.crumbs.hidden = this.filters.branch === null;
    this.crumbs.replaceChildren();
    const crumb = (text: string, branch: string | null) => { const b = button(text, "", () => { this.filters.branch = branch; this.changed(); }); b.dataset.browserKey = "crumb:" + branch; this.crumbs.append(b); };
    crumb("All time", null);
    const branch = this.filters.branch;
    if (branch === "unknown") crumb("Unknown", branch);
    else if (branch) { crumb(branch.slice(0, 4), branch.slice(0, 4)); if (branch.length >= 7) crumb(branch.slice(5, 7), branch.slice(0, 7)); if (branch.length === 10) crumb(branch.slice(8), branch); }
    this.directoryHeading.textContent = this.mode === "categories" ? "Categories" : "Timeline (UTC)";
    this.directoryHeading.title = this.mode === "categories" ? "Most loaded facts first" : "Browse year, month, day, then facts";
    const pager = (page: { page: number; pages: number; total: number }, text: HTMLElement, prev: HTMLButtonElement, next: HTMLButtonElement) => {
      text.textContent = `${page.page + 1}/${page.pages} · ${page.total} entries`;
      prev.disabled = page.page === 0; next.disabled = page.page + 1 >= page.pages;
    };
    pager(dg, this.directoryPage, this.prevDirectory, this.nextDirectory); pager(fp, this.factsPage, this.prevFacts, this.nextFacts);
    this.directory.replaceChildren();
    for (const g of dg.items) {
      const b = button("", "", g.action); b.className = "browser-group";
      b.append(node("span", g.label), node("span", `${g.count} loaded facts`));
      b.dataset.browserKey = "group:" + g.key;
      if (this.mode === "categories") b.dataset.categoryKey = g.key; else b.dataset.timeBranch = g.key;
      this.directory.append(b);
    }
    if (!dg.total) this.directory.append(node("p", rows.length ? "This branch is open. Read its facts below." : "No groups match. Clear a filter to browse again."));
    this.facts.replaceChildren();
    for (const row of fp.items) {
      const b = button("", "", () => {}); b.className = "browser-fact";
      b.dataset.factId = String(row.fact.fact_id); b.dataset.browserKey = "fact:" + row.fact.fact_id;
      b.addEventListener("click", e => store.select([row.fact.fact_id], e.ctrlKey || e.metaKey || e.shiftKey ? "add" : "set"));
      b.append(node("span", `${fid(row.fact.fact_id)} · ${categoryLabel(row.category)} · ${factDateLabel(row, this.filters.axis)}`), node("span", row.fact.content));
      this.facts.append(b);
    }
    if (!rows.length) this.facts.append(node("p", this.index.length ? "No loaded facts match these filters. Clear one filter or Clear all." : "No facts are loaded yet. Use Refresh to load available facts."));
    this.markSelection();
    if (focusKey) {
      const restored = [...this.host.querySelectorAll<HTMLElement>("[data-browser-key]")].find(el => el.dataset.browserKey === focusKey);
      (restored || this.host.querySelector<HTMLElement>("#browser-heading"))?.focus({ preventScroll: true });
    }
    this.host.scrollTop = scroll;
  }
}
