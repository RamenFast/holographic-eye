# D-0018 · agreed integration contract

## Layout and root-owned glue
- Root owns main.ts and state.ts, plus demonstrated pane focus repairs in panes.ts.
- Layout worker owns index.html, shared styles.css, modals.ts, and native main.rs.
- .app contains statusbar, #pane-switcher, .main, stream-dock, garden.
- #pane-switcher contains buttons [data-pane=explore|evidence|inspect]; Inspect has #inspect-selection-count.
- .main keeps #pane-left, new #explorer, and #pane-inspect mounted.
- #explorer contains #explorer-toolbar, #explorer-panels, and #boot-error outside the switchable panels.
- Toolbar: #explorer-tabs with buttons [data-view=field|categories|timeline], and #field-controls.
- Field controls: #field-zoom-out, #field-zoom-in, #field-fit, #field-text-mode.
- Panels: existing #field-wrap (all its canvas/garden/context nodes retained) and #fact-browser.
- Root controls hidden/inert on inactive panels, aria-selected/roving tab indices, and .app[data-layout=wide|compact][data-pane=...].
- Compact mode shows one full-width pane: Explore, Evidence, or Inspect. No new overlay/backdrop.
- Use compact mode when main width is below 250 + 304 + 400 * UI scale. Root measures scale from root font size /13.
- Explicit pane changes move focus to a visible heading or saved target. Resize preserves the pane owning focus. Selection updates the Inspect count, but does not steal focus.
- Native minimum is640x480. Dialog header remains fixed; only body scrolls, and width/height fit viewport minus24px.

## Field worker API
Own field.ts and field-labels.ts, plus label tests. Preserve geometry.ts and Zig.
- setActive(active:boolean): hidden Field stops draws/tooltips/keyboard handling, retains camera/data.
- setLabelMode(mode:"auto"|"off"), getLabelMode(): presentation preference only.
- labelStatus(): testable counts and accepted label rectangles/IDs, layout timing/rebuild count.
- invalidateLabels(): schedules one draw when active.
- zoomBy(factor:number): zoom about viewport center using the same width-and-height fit baseline as wheel.
- Existing fit(), requestDraw(), geometryStatus(), escapeHtml stay compatible.
- Auto labels: at most48 accepted and256 measured candidates, screen-space fixed readable font, one or two lines as space/zoom allow.
- Deterministic selected/hover/highlight priority, spatially distributed remaining candidates, fact-ID tie break.
- Reserve visible dot footprints, labels, context/math/tooltip regions and vectorless lane. Never move dots or add hit targets.
- Cache measurement/layout, no idle loops. Full layout p95 target<=8ms on20k fixture, reported honestly.

## Explorer worker API
Own explorer.ts, explorer-data.ts, explorer.css, and model tests. No shared source edits.
- export type BrowserView = "categories"|"timeline".
- export class MemoryExplorer with constructor(host:HTMLElement), setMode(view:BrowserView), setActive(active:boolean), status() for bounded test state.
- Host is #fact-browser. Root handles Field/Categories/Timeline tabs and host visibility.
- Read store.facts; use store.select for fact actions. Never duplicate selection, call RPC, fit the Field, or alter trust/entity lenses.
- Keep controls mounted while results change. Preserve filter/page/scroll state across modes and focus across refresh.
- Filters: case-insensitive content/ID substring; exact category or All; selected UTC time branch or All/Unknown; Stored/Last updated axis.
- AND filters in the browser views only. Do not add fuzzy search, arbitrary ranges, saved searches, journal history or server endpoints.
- Categories: count-ranked exact-value groups. Blank string and missing values are distinct typed keys, not colliding sentinel strings.
- Timeline: year/month/day/facts drill-down and Unknown branch. Stored=created_at; Last updated=updated_at only. No occurrence/revision claims.
- Trim surrounding whitespace, then parse only YYYY-MM-DD[ T]HH:mm:ss[.1–6 digits][Z|±HH:mm]. An optional suffix meansUTC per the actual provider/retriever contract; keep raw metadata unchanged.
- Validate Gregorian fields, years0001–9999, hours0–23, seconds0–59, offsets up to14:00. Reject -00:00 and invalid/locale/numeric/date-only forms toUnknown.
- Paginate both directories and facts at100. Counts say Loaded facts and reconcile with active facets.
- Render values as text and preserve original content/category strings. No persistence of facts, IDs or queries.

## Tests and scope
QA owns test_responsive_views.cjs. Root wires explorer.css into copy-static/index, adapts existing performance visual comparison with labels off, and reruns original suites.
All tests use synthetic data. The provider, databases, journal, tokens and other sessions stay unchanged.
Titlebar clarification remains pending; fix evidenced internal dialog defects now, retain native decorations.

## Visual review amendment: data before chrome
At640x480, the initial browser view must show at least one group or fact row, not only filter controls.
Keep the query visible. Put exact-category and clear-one controls in an explicit Filters disclosure (#browser-filters-toggle, #browser-extra-filters), with mounted state preserved.
Keep the Timeline axis visible in Timeline. Use concise loaded/matching coverage and show active facets only when present.
Date interpretation remains available in a persistent details/summary rather than taking the whole narrow viewport.
Combine heading and pager rows; retain existing selector IDs and accessible full names. No capability or filter is removed.
