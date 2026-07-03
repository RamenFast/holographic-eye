# The Holographic Eye — PLAN

**Single consolidated plan** (2026-07-02). This file replaces the earlier
`vision/ + spec/ + decisions/` tree at Ben's request — everything needed to build
is in this one document. Source-of-truth discipline (🫀Fi + 🧠Ti) still applies:
code compiles *from this file*; decisions made while building get folded back in.

**What this is:** a power-user runtime GUI + control plane for the Hermes
`holographic` memory provider — watch the agent's memory live (the Field: its real
HRR geometry, drawn), curate trust, review/undo every write, merge junk entities,
ask the agent itself to revise its memory. Zero Hermes core changes.

## Status: BUILT & LIVE (compiled 2026-07-02, single session)

**All phases P0–P7 are implemented, acceptance-tested, and deployed.** The
wrapper provider is the live `memory.provider` on the running gateway; the
journal is capturing every op; the GUI is served at `http://127.0.0.1:8770`
(token in `~/.hermes/eye_token`); the Tauri `.deb` is installed system-wide
(`holographic-eye` in the menu); `hermes holographic-eye` CLI + `/holo` chat
command are registered; first Backup Memory (D-0007) landed on Mass storage.
See README.md for daily use + recompile/rollback.

**Feedback round 2 APPLIED 2026-07-03** — all three polish priorities (P-1
render discipline/idle CPU, P-2 affordance truthfulness, P-3 one manual +
honest settings) plus the delight backlog (flower variety, cottage, text-size
setting) are live and verified: idle canvas draws 0/5s (was ~300),
Playwright-driven acceptance on every changed affordance — D-0010 below.

**→ Next session: start from `HANDOFF.md`** (top candidate: the inner
provider's `probe()` re-encodes every fact's content vector per call —
measured ~4s per entity click on 518 facts; a content-vector cache upstream
would make it ~ms. See D-0010 item 8.)

**Open threads for a future session:**
- Overnight/week soak observation (journal is accumulating; nothing to do
  unless drift appears — I2 was replay-verified offline).
- Live entity curation (merging the observed junk — "where am I on the plan",
  "Hey Nexus", … — is Ben's call via the Entity Desk; machinery is verified).
- Q5 (quarantine mode) stays deferred until journal-mode curation proves
  insufficient.
- Optional polish: UMAP opt-in projector, richer settings modal, upstream-PR
  grooming (explicitly out of v1).

Blossom is resolved (D-0006): it's Ben's own desktop theme at
`~/Dev/ClaudeWorkspace/blossom/` — the Eye adopts its palette, semantics, and icon
language. "Custom everything": icons, symbols, glyphs all bespoke, in Blossom's
visual language.

## Contents

- PART 1 — Vision 🫀
- PART 2 — Shell: Blossom 🫀 (palette, semantics, icon language, token remap)
- PART 3 — Environment ground truth 🧠
- PART 4 — Architecture contract 🧠
- PART 5 — Roadmap 🧠
- PART 6 — UI spec 🧠 (adopted wireframe, ~600 lines, canonical layout/interaction)
- PART 7 — Decision log (D-0001 … D-0010; D-0007+ live just above PART 7)

Ben's original drafts (pre-integration) are archived at
`~/Documents/📥 Inbox/HolographicEye-drafts/`.


---

# PART 1 — 🫀 Vision

*Name adopted from Ben's draft (D-0004). Retired working title: Holographic Studio.*

## The pitch

Hermes' holographic provider is the agent's deep memory: 500+ facts, entity links, trust
scores, real HRR phase-vector algebra. Today it is a black box — facts appear via tool
calls, trust never moves (505 of 516 facts sit at birth-trust 0.5), regex entity
extraction quietly mints junk, and the only window in is `fact_store(action="list")`
through the agent itself.

**The Holographic Eye is the glass cockpit for that memory.** A live console that
attaches to the running gateway and shows the memory *as the agent experiences it* —
every write as it lands, every prefetch as it's injected, every trust shift — and gives
the human a curation desk: edit, revert, re-weight, merge, and even ask the agent to
reconsider. The centerpiece is the Field: the actual 1024-dim representational geometry
of what the agent has bound and bundled, projected into a navigable 2D space. Not a
graph metaphor — the real algebra, drawn.

## Who it's for

Ben. One power user, one always-on gateway, one profile, Linux Mint/Cinnamon desktop.
Not a product, not multi-tenant. Power-user density is a feature.

## How it must feel

- **A live wire, not a report.** The Stream moves while the agent talks on Telegram in
  another window. Attach/detach anytime; the journal never blinks.
- **A gardener, not a customs officer.** Nothing blocks the agent's writes. The human
  prunes and waters *after* the fact — curation is async, calm, reversible.
- **The agent's own eyes.** Search in the Eye returns exactly what the agent's retriever
  returns — same FTS+HRR blend, same trust filter, same arithmetic, run by the same
  code. The Reason Workbench previews *the recall, not the answer* — honest wording.
- **The math is real, not metaphor.** The Field's positions come from the stored
  phase vectors; the FFT inspector shows the actual interference pattern of bound
  components. If it's on screen, it's in the database.
- **Trust made physical.** Trust is a dial you can grab. A healthy memory's trust
  histogram should *spread* over time; the Eye makes stagnation visible.
- **Undo as a birthright.** Every mutation — agent's or human's — is journaled with its
  before-image. Nothing edited blind, nothing lost silently.
- **The shell earns daily use.** 2000s tech-optimism glass outside, austere gold-on-
  black interior inside — see PART 2 (Blossom) for the full thesis and Ben's keyword
  bank (linux native, .deb, Cinnamon harmony, careful motion, readable density).

## The surface

Layout per PART 6 (UI spec): status bar · Entities pane · **the Field** · Inspect
pane · Stream footer, plus modal workbenches.

1. **The Field** — 2D scatter of every fact, positioned by PCA/UMAP of its real HRR
   vector; hue = category, saturation = trust, size = retrievals. New facts land as
   animated arrivals with gold ripples to their nearest neighbors; bank rebuilds pulse
   the category region.
2. **Stream** — realtime feed of every memory op: tool calls with results and timing,
   prefetch queries with the exact injected block, mirrors, auto-extracts, deletes.
3. **Entities pane** — the structural lens (probe is unbind, not keyword search);
   merge/alias/delete the junk that regex extraction mints.
4. **Inspect pane** — full fact anatomy: content, trust bar, counters, entity chips,
   vector; edit with server-computed impact preview; typed-ID delete; journal-powered
   undo.
5. **Reason Workbench** — pick entities, watch the provider's exact compositional
   arithmetic unfold, see what the agent *would have recalled*. The killer demo.
6. **Review Queue & Contradictions** — triage recent/provisional writes; standing
   `contradict` hygiene dashboard.
7. **Ask the Agent** — select facts, compose a request ("dedupe these", "reword 213"),
   inject into a live session via the gateway; the agent's mutations flow back through
   the Stream and Queue. The loop closes.
8. **FFT inspector** (opt-in) — the algebra made visible: spectra of fact, entity, and
   bank vectors.

## What it is NOT

- **Not a gate.** A hard approval gate makes the agent's memory lie to it mid-session.
  We refuse to inject bugs to debug bugs.
- **Not a second retrieval engine.** The GUI never reimplements search or the HRR math;
  the wrapper runs the provider's own code and the Eye displays it.
- **Not a DB admin tool.** No raw SQL from the client; every write flows through the
  provider's Python store API so entities, vectors, and banks stay coherent.
- **Not core surgery.** Zero diffs to Hermes core and zero edits to the bundled
  holographic plugin. Everything rides the sanctioned plugin API, out-of-tree.

## Success narrative (adopted from Ben's draft §9)

An hour of real agent work leaves 80 new facts. Open the Eye: dots clustered by topic.
Click one, read it, see why the agent would recall it. Fix a wrong fact — the field
reshapes. Run a reason over two entities — see exactly what the agent would have been
handed. Mark three facts unhelpful, watch them dim. Come back tomorrow: the field is
where you left it. You trust it.


---

# PART 2 — 🫀 The shell: Blossom

The Eye's visual identity is **Blossom** — Ben's own cohesive desktop theme
(`~/Dev/ClaudeWorkspace/blossom/`: Cinnamon/GTK/icons; sibling `blossom-shell` for
zsh). The draft docs' material language survives (glass done deliberately, careful
motion, no bounce, no toasts, monospace numerics, readable technical density) but
the palette and semantics are Blossom's, not the draft's generic gold-on-black.

## Blossom palette (canonical, from blossom/README.md)

| | Value | Role |
|---|---|---|
| ⚫ base | `#000000` | true black (AMOLED); raised surfaces `#0a0a0a`–`#3b3b3b` |
| 🌸 pink | `#db3776` | **primary — what you're acting on**: selection, focus, links, active window, primary action |
| 🟡 gold | `#f1bf40` | **secondary — the reference you're acting against**: today-marker, warnings |
| 🩵 text | `#eaf6ff` | text & icons (dims to `#9fb3c2` secondary) |
| 🔴 red | `#ec4e53` | critical/destructive only |
| 🟢 green | `#52a462` | success semantic only |

**The design rule (Ben's, verbatim):** *pink is what you're acting on, gold is the
reference you're acting against, red is danger.*

## Token remap — draft wireframe (PART 6 §8) → Blossom

| Draft token | Was | Becomes |
|---|---|---|
| `--ink-base` | `#0a0a0c` | `#000000` (raised: `#0a0a0a`+) |
| `--ink-text` / `-dim` | `#e8e6e0` / `#8a8780` | `#eaf6ff` / `#9fb3c2` |
| `--edge-gold` (focus/selection/halos) | `#c8a04a` | **pink `#db3776`** — selection, focused pane edge, dot rings, hover glow (acting on) |
| `--edge-gold-dim` (idle edges) | rgba gold | `rgba(219,55,118,0.30)` or neutral `#3b3b3b` hairline — tune at P7 |
| `--numerics` | `#f4d27a` | gold-tinted `#f1bf40` (measurements are *reference* values) |
| `--signal-warn` | `#d97757` | gold `#f1bf40` (Blossom: warnings are gold) |
| `--signal-add` / `--signal-remove` | greens/reds | `#52a462` / `#ec4e53` |
| min_trust threshold line, SNR marker, "recalled by agent" highlight | (new) | gold — these are the *references you act against* |
| delete / destructive confirm | gold-ish | red `#ec4e53` |

New-fact arrival ripple: pink (the agent *acted*). Bank-rebuild pulse: gold (the
reference shifted). Category hues: draft's warm-gold `user_pref` collides with
gold-as-reference — recolor the 4 category hues at P7 (candidate: pink-leaning,
blue `#5e8aa8`, silver, graphite; keep low chroma). Field dots stay
saturation-mapped to trust.

## Icons & symbols — custom everything (Ben, 2026-07-02)

Blossom icon language: **dark body, light-blue line glyph, pink accent, gold for
anchors** — generated SVG (see `blossom/tools/blossom_icons.py` for the pattern).
The Eye ships its own set in that language:

- **App icon**: concentric-ring hologram glyph (interference-pattern echo) — dark
  body, light-blue rings, one pink arc; multiple resolutions + `.desktop` + XDG.
- **Status-bar glyph** `⊙` (pulses while the stream is live — pink pulse).
- **Entity-state monograms**: `⊙` probed-recently (pink), `○` idle (light-blue dim),
  `⊗` zero-facts (gold — it's a warning).
- **Pane/action glyphs**: search, reason, undo, merge, trust dial, journal — line
  style matching the folder glyph set.
- Numerics/typography rules from the draft stand (mono for measurements, humanist
  for prose); zsh users get a matching `blossom-shell` prompt vibe for `hermes holo`
  CLI output (nicety, not a contract).

## Anti-goals (kept from the draft)

No 3D field, no dark/light toggle, no success toasts, no AI-generated splash art,
no bounce/spring physics; honest about being a database tool with taste. Glass is
deliberate; on Cinnamon, harmonize with Muffin chrome, don't fight it.


---

# PART 3 — 🧠 Environment ground truth

Researched live on 2026-07-02 against the running install. If any item here stops being
true, the spec must be re-verified before compiling.

## Install

- Hermes fork: **Nexus Agent v0.18.0** (upstream `4a09b692`), Python 3.11.15, repo at
  `~/.hermes/hermes-agent`, venv at `~/.hermes/hermes-agent/venv`.
- `HERMES_HOME = ~/.hermes`. Gateway runs always-on (`gateway.pid`).
- Active memory provider: `memory.provider: holographic` in `~/.hermes/config.yaml`.
  Core memory config also carries `write_approval: false` (built-in memory, not provider).

## The holographic provider (bundled, DO NOT EDIT)

Path: `~/.hermes/hermes-agent/plugins/memory/holographic/`

| File | Role |
|---|---|
| `__init__.py` | `HolographicMemoryProvider(MemoryProvider)`, 2 tool schemas, hooks, `register(ctx)` |
| `store.py` | `MemoryStore`: SQLite (WAL w/ fallback), schema, entity extraction, trust constants |
| `retrieval.py` | `FactRetriever`: FTS + HRR blend, `search/probe/related/reason/contradict` |
| `holographic.py` | HRR vector math (numpy optional; store tracks `_HAS_NUMPY`) |

Tools exposed to the agent:
- `fact_store` — actions `add, search, probe, related, reason, contradict, update, remove, list`
- `fact_feedback` — `helpful` (+0.05 trust), `unhelpful` (−0.10); clamp [0.0, 1.0]

Hooks implemented: `system_prompt_block`, `prefetch` (top-5, `min_trust` default 0.3),
`sync_turn` (no-op), `on_session_end` (regex auto-extract, off by default),
`on_memory_write` (mirrors built-in memory adds as facts), `shutdown` (closes SQLite).

Config lives under `plugins.hermes-memory-store` in `config.yaml`:
`db_path, auto_extract, default_trust (0.5), min_trust_threshold (0.3), hrr_dim (1024),
hrr_weight (0.3), temporal_decay_half_life (0)`.

## Database

`~/.hermes/memory_store.db` — SQLite, **WAL confirmed live**. Snapshot 2026-07-02:
516 facts, 620 entities, 685 fact_entities links, 7 memory_banks.
Trust histogram: {0.2: 1, 0.3: 1, **0.5: 505**, 0.6: 9} → feedback loop effectively unused.

Schema: `facts(fact_id, content UNIQUE, category, tags, trust_score, retrieval_count,
helpful_count, created_at, updated_at, hrr_vector BLOB)`, `entities(entity_id, name,
entity_type, aliases, created_at)`, `fact_entities(fact_id, entity_id)`, FTS5
`facts_fts` (content-linked, trigger-maintained), `memory_banks(bank_name, vector, dim,
fact_count, updated_at)`. Entity extraction is regex (capitalized multi-words, quoted
strings, "aka") → junk entities are expected and observed.

## Plugin system facts

- `MemoryProvider` ABC: `agent/memory_provider.py`. Registration:
  `def register(ctx): ctx.register_memory_provider(provider)` — convention discovery,
  no core changes needed. Test harness: `agent/memory_manager.py`,
  `tests/agent/test_memory_provider.py`.
- **Out-of-tree plugin dir exists and works**: `~/.hermes/plugins/` (Ben's
  `gemma-local-commands`, `gemma-native-stt`, `model-providers` live there).
  Loader: `hermes_cli/plugins.py` — "discovers from four sources".
  ⚠ VERIFY in P1: `register_memory_provider` is exposed to out-of-tree `ctx` (expected;
  fallback = in-tree dir in the fork, acceptable since the repo is Ben's fork).
- Threading contract: `sync_turn` must be non-blocking; **daemon threads sanctioned** —
  this is what legitimizes an in-process control-plane server.
- Plugins may ship `cli.py` (`register_cli`) → `hermes <cmd>` subcommands; custom slash
  commands via the same plugin system (Ben has prior art: /mtp, /local-fix …).

## Adjacent core machinery

- `tools/write_approval.py` + `hermes_cli/write_approval_commands.py`: generic pending
  list / approve / reject / diff, subsystems `memory` + `skills`, surfaced in CLI **and**
  chat platforms. Not provider-aware; we align vocabulary, we do not modify it.
- Gateway platforms: `gateway/platforms/api_server.py`, `webhook.py` → programmatic
  message-injection path for ask-the-agent (⚠ VERIFY endpoint shape + auth in P6).
- Central logging: `hermes_logging.py`; providers use module loggers, mostly `debug`
  level, several `except Exception: pass` swallows in the bundled plugin (mirror,
  save_config) — invisible failures the journal must catch.

## Addendum — verified 2026-07-02 (evening pass)

- numpy 2.4.3 present in the venv; 7 of 516 facts have `hrr_vector IS NULL`
  (backfill candidates).
- `provider.prefetch` IS wired in core: `agent/memory_manager.py:507` (plus
  `queue_prefetch` at :535). The upstream bug claimed in Ben's RISKS draft
  (#31263, "prefetch never fires") does not obviously apply to this fork —
  P1's journal settles it empirically.
- Desktop confirmed: Linux Mint, Cinnamon (`XDG_CURRENT_DESKTOP=X-Cinnamon`).
- HRR module surface confirmed in `holographic.py`: `encode_atom, bind, unbind,
  bundle, similarity, encode_text, encode_fact, snr_estimate`; role atoms
  `__hrr_role_content__` / `__hrr_role_entity__`; entities lowercased at encode.
  `store._rebuild_bank(category)` runs after add/update/remove.

## Addendum 2 — discovered during P0/P1 compile (2026-07-02, late)

- **Q1 RESOLVED — YES.** `plugins/memory/__init__.py` explicitly scans
  `$HERMES_HOME/plugins/<name>/` for memory providers (heuristic: `__init__.py`
  mentions `MemoryProvider`/`register_memory_provider`), loads them as
  `_hermes_user_memory.<name>` via a `_ProviderCollector` ctx, and the general
  PluginManager auto-coerces such dirs to `kind: exclusive` so they aren't
  double-loaded. Selection stays `memory.provider` in config.yaml. Caveat:
  `discover_memory_providers()` (used by `hermes memory status`/setup) calls
  `register()` + `is_available()` on every provider — so the wrapper's
  `register()`/constructor must be cheap and side-effect-free; the journal and
  control plane start in `initialize()` only.
- **The live DB has 7 categories, not 4**: general(122), lesson(21), project(53),
  seed(21), session(16), tool(24), user_pref(259). The `fact_store` schema enum
  only offers 4 — lesson/seed/session came from other write paths. The 7
  memory_banks are exactly these `cat:*` banks. GUI + Field hues must handle
  arbitrary categories, with the 4 canonical ones styled and a fallback hue ramp
  for the rest.
- **`retrieval_count` never increments on this fork**: max is 0 across all 516
  facts. `FactRetriever._fts_candidates` runs its own SQL and never bumps the
  counter — only `store.search_facts` does, and nothing calls it. Consequence:
  the wireframe's dot-radius (`retrieval_count`) and Inspect "retrieved N×"
  would be flat forever. The Eye instead derives **journal-observed retrieval
  counts** (appearances of a fact_id in journaled search/probe/related/reason
  results + prefetch injections) and labels them as such. Dot radius uses
  max(db retrieval_count, journal-observed).
- `memory_manager` inspects `on_memory_write` signatures — wrapper accepts the
  modern `(action, target, content, metadata=None)` form and forwards the
  3-arg form the bundled provider expects.
- `plugins.hermes-memory-store.auto_extract` is **true** on this install (PART 3
  said off-by-default; Ben enabled it) — session-end auto-extract WILL fire and
  must be journaled (D-0003c is live, not theoretical).

## Constraints inherited

1. Only ONE external provider active at a time → the Studio wrapper must *replace*
   `holographic` in config while delegating to it (composition, not coexistence).
2. All storage under `$HERMES_HOME` from `initialize()` (profile isolation).
3. `sqlite3` CLI is not installed on the box; use the venv Python for ad-hoc DB work.


---

# PART 4 — 🧠 Architecture contract

```
┌─ Hermes gateway process (always-on) ─────────────────────────┐
│  holographic-eye — wrapper MemoryProvider (Python)           │
│  at ~/.hermes/plugins/holographic-eye/                       │
│   ├─ delegate: bundled HolographicMemoryProvider (unmodified)│
│   ├─ journal:  every op → eye_journal.db (append-only)       │
│   ├─ policy:   staging mode (journal | quarantine | hybrid)  │
│   └─ control plane: 127.0.0.1 HTTP+WS, bearer token,         │
│                     daemon thread; serves frontend bundle    │
└───────────────┬──────────────────────────────────────────────┘
        WS events + JSON RPC                 gateway msg API
┌───────────────┴───────────────┐      ┌──────────────────────┐
│ The Holographic Eye GUI —     │──────│ ask-the-agent bridge │
│ TS canvas app in Tauri shell  │      │        (P6)          │
│ (also LAN-servable by C4)     │      └──────────────────────┘
└───────────────────────────────┘
```

## Components

### C1 — Wrapper provider (`holographic-eye`, Python, out-of-tree)
- `name` → `"holographic-eye"`; selected via `memory.provider` in config.yaml.
- Constructs the bundled `HolographicMemoryProvider` and **delegates every ABC method**.
  Interception points: `handle_tool_call` (both tools, all actions), `prefetch`,
  `on_memory_write`, `on_session_end`, `initialize`, `shutdown`.
- Never re-implements store/retrieval logic. Imports the bundled plugin's modules for
  privileged operations (entity merge, trust set) so entity/HRR invariants hold.

### C2 — Op journal (`$HERMES_HOME/eye_journal.db`, SQLite WAL, separate file)
```sql
events(
  event_id   INTEGER PRIMARY KEY,
  ts         TEXT,     -- ISO8601 UTC
  session_id TEXT,
  source     TEXT,     -- tool | prefetch | mirror | auto_extract | eye | undo
  kind       TEXT,     -- add | search | probe | ... | helpful | inject | entity_merge
  request    TEXT,     -- JSON args as received
  response   TEXT,     -- JSON result returned (or error)
  before     TEXT,     -- JSON full prior row(s): facts + entity links (mutations only)
  after      TEXT,     -- JSON full new row(s)
  undone_by  INTEGER   -- NULL, or event_id of the reverting event
)
```
- Append-only; mutations carry complete before/after images including `hrr_vector`
  (base64) so undo restores byte-identical rows.
- Separate DB file → zero schema footprint on `memory_store.db` (upstream-compatible).

### C3 — Staging policy engine (inside C1)
Modes (config `plugins.holographic-eye.mode`):
- `journal` (default): delegate immediately, record event. Agent behavior is identical
  to stock holographic. Review is post-hoc via queue + undo.
- `quarantine`: after delegated `add`, set trust below `min_trust_threshold`; approval
  = trust restore. Available per-category via `policy:` map (hybrid).
- Hard gate: **rejected** — see D-0001. Not built.

### C4 — Control plane (inside C1, daemon thread)
- Bind `127.0.0.1:<port>` (default 8770), bearer token generated into
  `$HERMES_HOME/eye_token` (0600).
- `GET  /health`, `GET /stats` — counts, trust histogram, journal lag.
- `POST /rpc` — methods:
  - passthrough reads (live retriever, agent-fidelity): `search, probe, related,
    reason, contradict, list`
  - explain reads (same code paths, intermediates exposed, for the Reason
    Workbench & FFT inspector): `reason.explain` (per-fact sim/trust/score +
    probe-key composition), `fact.spectrum` (FFT magnitudes of fact / entity /
    bank vectors), `field.projection` (PCA default, UMAP opt-in; server-side —
    numpy lives here)
  - previews (server-computed by the real provider code, never client-side):
    `fact.preview_update` (predicted entities + bank impact, incl. category-move
    old-bank/new-bank counts)
  - mutations (journaled, `source=eye`): `fact.add, fact.update, fact.remove,
    fact.trust_set, entity.merge, entity.alias, entity.remove, undo(event_id),
    backfill_vectors` (re-encode NULL `hrr_vector` rows; 7 exist today)
- `WS /events` — pushes every journal event as it commits; topics: `ops, prefetch,
  session`.
- `GET /` — serves the frontend bundle (same UI as the Tauri shell) for LAN use.
- Contract: RPC read responses are **byte-equivalent** to what `handle_tool_call`
  would return for the same args.

### C5 — The Eye GUI (TS canvas frontend + Tauri shell — D-0005)
- `build/eye_frontend/` (TypeScript, Canvas2D field, panes per PART 6 (UI spec))
  and `build/eye_shell/` (Tauri; native window, .deb packaging, icons).
- Talks only to C4 (RPC + WS). No direct SQLite access in v1 (fidelity rule); a
  read-only stats view MAY read the DB directly later (reads are WAL-safe).

### C6 — Ask-the-agent bridge (P6)
- Eye → gateway message-injection (api_server platform) with a composed prompt
  referencing fact IDs; resulting agent mutations arrive as ordinary C2 events.
- Endpoint shape/auth is an OPEN question — verify before speccing further.

## Invariants (acceptance-checked)

- **I1** Zero diffs to Hermes core and to the bundled holographic plugin.
- **I2** With `mode: journal`, agent-visible behavior is bit-identical to stock
  holographic (same tool results, same prefetch blocks).
- **I3** Every memory mutation, from any source, produces exactly one journal event
  with a complete before/after image.
- **I4** `undo(event_id)` restores the prior state byte-identically (incl. hrr_vector,
  entity links) and is itself journaled.
- **I5** All writes execute through the bundled plugin's Python store API or within
  the wrapper's Python process — never raw SQL from the GUI side.
- **I6** GUI search/probe/reason/contradict results are byte-equivalent to the agent's
  tool results for identical args (RPC passthrough, no reimplementation).
- **I7** GUI attach/detach at any time never blocks or errors the agent; control-plane
  failure degrades to stock provider behavior (journal best-effort, delegation always).
- **I8** Control plane is loopback-only + token-authed; no external exposure.

## Open questions — ALL RESOLVED during the 2026-07-02 build

- **Q1 (P1) ✅ YES**: `plugins/memory/__init__.py` scans `$HERMES_HOME/plugins/`
  for memory providers; `holographic-eye` discovered `available=True` alongside
  the bundled providers. See PART 3 Addendum 2 for mechanics + the
  cheap-register caveat.
- **Q2 (P1) ✅ DETERMINISTIC**: atoms are SHA-256-derived by construction;
  verified across two processes (identical digests). Undo still restores the
  stored blob (entity-set context can differ), as specced.
- **Q3 (P2) ✅ NO PARTIAL EVENTS**: each journal event is one INSERT+commit in
  WAL mode — a crash mid-op loses at most that single uncommitted event,
  never a partial row. Nothing to recover.
- **Q4 (P6) ✅ USABLE**: `gateway/platforms/api_server.py` is a full
  OpenAI-compatible HTTP API on loopback :8642 (`/v1/chat/completions`,
  `/v1/runs`, sessions), bearer-authed via `API_SERVER_KEY`. The key was not
  set on this install; one was generated and appended to `~/.hermes/.env`
  on 2026-07-02 (loopback-only bind verified before enabling). Live-tested:
  a chat completion drove a real agent turn that stored fact #535.
- **Q5 (P4)**: still deferred — journal-mode curation first; quarantine only
  on demonstrated need.
- **Q6 (P3) ✅ REAL STRUCTURE**: PCA in the [cos θ, sin θ] embedding (whose
  inner product equals the provider's phase-cosine similarity exactly) puts
  entity-sharing fact pairs at **0.31×** the mean random-pair distance
  (99 sharing pairs, live-copy DB). No fallback layout needed.
- **Q7 (P1) ✅ PREFETCH FIRES**: journal event #2 on the live gateway is
  `source=prefetch` with the exact injected block (616 chars, 5 fact_ids,
  92ms). Upstream bug #31263 does not affect this fork.

## Build-time decisions folded back (2026-07-02)

- **Single-restart deployment**: P1+P2 were deployed together in one config
  swap + one gateway restart to avoid restarting Ben's always-on gateway
  twice. Per-phase acceptance still ran separately (offline harnesses in
  `build/verify/`, then live checks).
- **Control-plane ownership**: the plane belongs to the always-on gateway.
  `initialize(platform="cli")` skips it (a transient CLI process must not
  steal port 8770 and die with it); config `plugins.holographic-eye.
  control_plane: always|never|auto` overrides. Journaling is unaffected.
- **C2 schema addition**: events carry `duration_ms` (Stream displays op
  timing per the wireframe).
- **Prefetch journaling envelope**: `response = {block, fact_ids, chars}` —
  `block` is the byte-exact injected text; `fact_ids` (from one extra
  read-only retriever call) power journal-observed retrieval counts.
- **LAN dual-serve vs I8**: default bind stays 127.0.0.1 (I8); LAN serving
  is an explicit `bind: 0.0.0.0` opt-in, still token-authed.
- **memory_banks.updated_at** is excluded from the I4 byte-identity contract
  (derived-cache metadata); bank *vector bytes* are compared.
- **CLI name**: the active-memory-plugin CLI contract fixes the command name to
  the provider dir name → `hermes holographic-eye …` (not `hermes holo`). The
  handler is bound via `globals()["holographic-eye_command"]` because the dir
  name isn't a Python identifier.
- **/holo routing**: registered via a tiny companion standalone plugin
  (`holographic-eye-commands` — exclusive-kind plugins can't register slash
  commands; its source must avoid the memory-provider heuristic tokens).
  Works on messaging platforms + CLI sessions; the api_server chat endpoint
  passes text straight to the agent, bypassing slash dispatch.
- **Server-code redeploys need a gateway restart**: the memory-plugin loader
  pre-imports every `*.py` in the plugin dir at provider load, so lazy imports
  do not pick up changed files in a running gateway.
- **GUI polish honesty**: status bar shows "journal ●" (fresh) vs "quiet Nm" —
  event-age is quietness, not lag; entity highlight recovers the wireframe's
  sim>0.35 cut from probe scores (score = (sim+1)/2·trust).


---

# PART 5 — 🧠 Roadmap

Each phase compiles from this source tree and ends with pass/fail acceptance. Effort is
in focused sessions (~2-4h each). License for all compiled code: GPLv3 (Ben's default).

> **2026-07-02: ALL PHASES SHIPPED in one session.** P0 ✅ (mockup + ratification)
> · P1 ✅ (15/15 offline checks; live: journal capturing, Q1/Q2/Q7 resolved)
> · P2 ✅ (25/25 checks; WS 50ms) · P3 ✅ (GUI live, Q6: 0.31× ratio)
> · P4 ✅ (all 9 undo kinds byte-identical; live bad-fact revert in 0.21s)
> · P5 ✅ (merge/alias/remove/backfill undoable; explain ≡ reason; FFT)
> · P6 ✅ (agent.ask round-trip live: agent stored f#537, loop visible in journal)
> · P7 ✅ (Blossom icons, Tauri .deb built + installed, CLI, /holo, README, GPLv3)
> · D-0007 ✅ (Backup Memory; first backup on Mass storage).
> P1/P2 deployed together (single gateway restart). Soak continues passively.

## P0 — Contract (this tree) — DONE except mockup
- Deliverables: this PLAN (done); `mockup.html` (beside this PLAN) — single-file rendered
  mockup (layout per PART 6 (UI spec), shell per PART 2 (Blossom)).
- Acceptance: a fresh agent given only this tree can restate the architecture and
  build P1 without guessing. Ben has ratified D-0001, 0003, 0005.

## P1 — Wrapper plugin + op journal (~2 sessions) ← first real value, GUI-less
- `~/.hermes/plugins/holographic-eye/`: wrapper provider (C1) + journal (C2),
  `mode: journal` only. Resolve Q1 (out-of-tree registration), Q2 (HRR determinism)
  and Q7 (does prefetch fire?) first — the load-bearing unknowns.
- Config swap: `memory.provider: holographic-eye`. Rollback = one-line revert.
- Acceptance: I1, I2 (replay a scripted fact_store session against stock vs wrapped —
  identical outputs), I3 (every op journaled incl. prefetch + mirror), `hermes memory
  status` shows the provider healthy; gateway soak overnight with zero behavior drift.

## P2 — Control plane (~2 sessions)
- HTTP+WS server (C4) in daemon thread, token auth, /health /stats /rpc /events.
- Acceptance: I6 (byte-equivalence harness: N recorded agent calls replayed via RPC),
  I7 (kill -9 the GUI/clients mid-op → agent unaffected), I8 (external bind refused,
  bad token 401), WS event visible < 250ms after op commit.

## P3 — GUI, read-only (~3-4 sessions)
- TS frontend (Tauri dev shell): Stream pane + the Field (PCA projection via
  `field.projection`, arrival animations per PART 6 (UI spec) §3.5) + Inspect
  (read-only) + status bar (fact count, trust histogram sparkline, SNR, journal lag).
  Resolve Q6 (projection sanity) before polishing Field interactions.
- Acceptance: ops appear live while a real Telegram session runs; search results
  match a parallel `fact_store` call verbatim; attach/detach loop 10× clean; wireframe
  §3.8-equivalent promises 1–2 hold.

## P4 — Write path: Review Queue, trust curation, undo (~3 sessions)
- Mutations via RPC: edit (with `fact.preview_update` impact preview + diff modal per
  wireframe §7.2), remove (typed-ID confirm §7.3), trust_set, feedback buttons;
  Review Queue over recent journal events; undo(event_id); batch operations.
- Acceptance: I4 (undo restores byte-identical row + links, verified by SQL diff),
  I5, trust histogram visibly editable; a deliberate bad fact planted → found →
  reverted end-to-end in under 60s of human time; preview matches actual commit
  on 10 varied edits (RISKS draft Risk 7 test).

## P5 — Entity Desk, Contradictions, Reason Workbench, FFT (~3 sessions)
- entity.merge / alias / remove with full journaling; standing contradict dashboard;
  Reason Workbench (`reason.explain`, wireframe §7.1 — copy says "previews the
  recall, not the answer"); FFT inspector (`fact.spectrum`, §6); `backfill_vectors`.
- Acceptance: merging two known-duplicate entities relinks all facts (SQL-verified),
  is undoable, and the agent's probe results reflect the merge immediately;
  Workbench ranking equals a live `fact_store(action="reason")` for same entities.

## P6 — Ask-the-agent loop (~2 sessions, gated on Q4)
- Compose request over selected fact IDs → inject via gateway api_server → agent's
  mutations land in Live Wire/Queue tagged to the request.
- Acceptance: "dedupe facts A/B" round-trip works on the live gateway; if Q4 proves
  the endpoint unusable, fallback = deep-link that copies the composed prompt for
  manual paste (explicitly acceptable degradation).

## P7 — Shell + packaging (~2-3 sessions)
- The L2 pass: glass material language recolored to **Blossom** (Ben's own desktop
  theme, `~/Dev/ClaudeWorkspace/blossom/`) — palette remap per the Blossom section;
  reduced-motion support.
- **Blossom icons & symbols, custom everything**: app icon (concentric-ring
  hologram glyph in the Blossom icon language — dark body, light-blue line glyph,
  pink accent), pane glyphs, entity-state monograms (⊙/○/⊗), category markers —
  same generated-SVG approach as `blossom/tools/blossom_icons.py`.
- Tauri `.deb` for Mint/Cinnamon: icons, .desktop entry, clean install/uninstall
  (Ben's keyword bank); `/holo` slash command (prior art: Ben's command plugins);
  `hermes holo` CLI (status, tail, undo-last); README + GPLv3; optional:
  upstream-PR grooming (explicitly out of v1 scope).

## Standing rules
- Fold-back is mandatory: any decision made while compiling lands in this PLAN
  (architecture part or decision log) the same session.
- `build/` is disposable at every phase boundary; recompile from source must work.
- No phase starts until the previous phase's acceptance passes on the live gateway.


---

# PART 6 — 🧠 UI spec (adopted from Ben's WIREFRAME.md draft, 2026-07-01)

> QC verdict: PASS, adopted nearly verbatim as the canonical layout/interaction spec.
> Every provider internal it cites (`_rebuild_bank`, `snr_estimate`, role atoms,
> `encode_fact`) was verified against the live plugin source on 2026-07-02.
> The following deltas apply under the wrapper architecture (PART 4 (architecture));
> where this document conflicts with them, the deltas win:
>
> 1. **Event source.** The Stream pane is fed by the wrapper's journal over WS —
>    not WAL-tailing or `agent.log` parsing. Every event type in §5.2 (including
>    `hrr_compute`, `bank_rebuild`, `entity±1`, deletes) is emitted for real at the
>    moment it happens inside the provider. RISKS.md Risks 2 and 4 are void.
> 2. **Writes.** All mutations go through control-plane RPC (journaled, undoable) —
>    the draft's "MCP-exposed actions" path is replaced. §7.2's predicted entities /
>    bank impact are computed server-side by the actual provider code, so preview
>    drift (RISKS.md Risk 7) is void. Add an **undo affordance** (journal-powered)
>    to the Inspect pane actions and a **Review Queue / Contradictions** view — two
>    panes this draft predates; layout slot: tabs sharing the Entities column.
> 3. **Naming.** "M3" → the agent (contest framing retired). App name stays
>    **The Holographic Eye**. Frontend runs in a Tauri shell and is also servable
>    to a LAN browser by the control plane (D-0005).
> 4. **Field projection.** PCA is the default projector; UMAP is opt-in
>    (RISKS.md Risk 1 carried into PART 4 (architecture) open questions).

---

# Holographic Eye — Minimal Wireframe + UI Spec

Companion to `VISION.md`. This is the document a designer (or me, on day 2) uses to build the shell. It is grounded in the verified schema and the actual tool surface — no aspirational features.

---

## 0. Application frame

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ⊙ The Holographic Eye    ● live   1,247 facts · 348 entities · SNR 1.92 ⚠   │ ← status bar
├──────────────┬───────────────────────────────────────────────┬──────────────┤
│              │                                               │              │
│  ENTITIES    │              T H E   F I E L D                │   INSPECT    │
│              │                                               │              │
│  348 total   │  (UMAP/PCA scatter of hrr_vector, 1024-d)     │              │
│              │                                               │              │
│  ▸ pycharm   │                                               │              │
│  ▸ hermes    │                                               │              │
│  ▸ m3        │                                               │              │
│  ▸ rsi       │                                               │              │
│  ▸ debugger  │                                               │              │
│  ▸ postgres  │                                               │              │
│  ▸ …         │                                               │              │
│              │                                               │              │
│  ──────      │                                               │              │
│  + 341 more  │                                               │              │
│              │                                               │              │
├──────────────┴───────────────────────────────────────────────┴──────────────┤
│  STREAM  16:42:08 fact_store(add)       "User prefers PyCharm over…"  ✓ 38ms │ ← footer
└──────────────────────────────────────────────────────────────────────────────┘
```

Three columns. Field is dominant. Footer is thin. Status bar is thin. **The proportions are the design**: the field gets the most space because it is the thing the user came for.

### Frame measurements (in `rem`, root = 16px)

- Window: full viewport. Min 1100×680, default 1440×900.
- Status bar: 32px tall, full width.
- Footer (stream): 28px tall * 3 rows = 84px, full width, scrollable.
- Left column (entities): 240px wide, scrollable, no resize.
- Right column (inspect): 320px wide, scrollable, no resize.
- Field: everything in between (default ≈ 880px × ~720px on a 1440×900 window with status/footer subtracted).

Edges: 1px hairline `edge-gold`. Focus state: full chroma. Unfocus: `edge-gold-dim`. The interior of every pane is `ink-base` (`#0a0a0c`); the shell's glass is *only* at the window's outer 8px, where backdrop-filter blurs the OS.

---

## 1. Status bar (the iStat tribute)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ⊙ The Holographic Eye    ● live   1,247 facts · 348 entities · SNR 1.92 ⚠   │
└──────────────────────────────────────────────────────────────────────────────┘
   ↑                 ↑     ↑                                              ↑
   glyph             live  metrics (mono)                                warning
```

- **Glyph** `⊙`: 12×12px, `edge-gold`, pulses 60%→30% opacity over 1s when stream is active, static when idle.
- **App name**: 12px humanist sans, regular, `ink-text`.
- **`● live`**: 8px dot, `signal-add` if connected, `signal-warn` if degraded, `ink-text-dim` if disconnected. Label: 11px humanist, `ink-text-dim`.
- **Metrics**: 11px mono, `ink-text-dim`. Counts are right-aligned. SNR gets a `⚠` glyph if `snr_estimate(dim, total_facts) < 2.0`.
- **Right side (omitted from the wireframe, but real)**: `⌘E Edit · ⌘R Reason · ⌘, Settings · ⌘Q Quit`. 11px humanist, `ink-text-dim`. Hover: `ink-text`.

---

## 2. Entities pane (left column)

```
ENTITIES
348 total

▸ pycharm          ⊙
▸ hermes           ○
▸ m3               ⊙
▸ rsi              ⊗
▸ debugger         ○
▸ postgres         ○
▸ …

──────────
+ 341 more
```

- **Header**: 11px mono, `edge-gold`, letter-spacing 0.1em, uppercase: `ENTITIES`. Below it, in `ink-text-dim`: `348 total`.
- **List rows**: 32px tall. Each row:
  - `▸` chevron (10px, `edge-gold-dim`, rotates 90° on hover).
  - Entity name (13px humanist, `ink-text`).
  - State glyph on the right: `⊙` if probed in the last 60s (`edge-gold`), `○` if not probed recently (`ink-text-dim`), `⊗` if zero facts linked (`signal-warn`).
- **Hover**: row background `rgba(255,255,255,0.04)`, name color → `ink-text` (full).
- **Click**: the field highlights all facts where this entity is structurally present (cosine to `unbind(fact_vec, bind(entity_vec, ROLE_ENTITY))` is > 0.5). The entity's state glyph becomes `⊙`.
- **`⌘-click`**: multi-select. The Reason Workbench auto-opens with the selected entities.
- **Right-click**: a small menu — *Promote to category* (sets `entity_type` in the `entities` table, no semantic effect, just visual organization in the field), *Filter field to facts-with-this-entity*, *Copy entity name*.
- **`+ N more`**: a small disclosure at the bottom, 11px humanist, `ink-text-dim`. Expands the list inline.

The entity list scrolls independently of the field. Default sort: by `fact_count DESC` (entity with the most facts on top).

---

## 3. The Field (center, dominant)

```
                      T H E   F I E L D
                  (hover state: dot 0427, top-3 in tooltip)
```

### 3.1 Background

- Base: `ink-base` (`#0a0a0c`).
- Subtle radial gradient from center, `rgba(255,255,255,0.02)` at center to transparent at edges. This gives the field a sense of *depth* without being a 3D trick.
- A 1px hairline grid every 80px, `rgba(255,255,255,0.02)`. This is the only "graph paper" the user sees — it's a reference, not a decoration.

### 3.2 The dots

| Visual property | Source field | Mapping |
|---|---|---|
| `(x, y)` | `hrr_vector` (1024-d) | UMAP or PCA projection |
| Hue | `category` | See color table below |
| Saturation | `trust_score` | `saturation = 0.4 + trust * 0.6` (never fully desaturated) |
| Opacity | `age` (with half-life) | `opacity = 0.5^(age_days / half_life)`; default half-life = 30 days (matches the provider's `temporal_decay_half_life` config) |
| Radius | `retrieval_count` | `r = 2 + log(1 + retrieval_count) * 1.5` (clamped to 2..8) |
| Stroke | selection | Hover: 1px `edge-gold` at 60% opacity. Selected: 1px `edge-gold` at 100% opacity. |

**Category hues** (all `hsl(...)`):

| Category | Hue | Lightness | Saturation |
|---|---|---|---|
| `user_pref` | 38° (warm gold) | 55% | 65% |
| `project` | 210° (cool blue) | 55% | 50% |
| `tool` | 0° (silver) | 70% | 0% (literal silver) |
| `general` | 0° | 50% | 0% (graphite) |

When `hrr_vector` is `NULL` (numpy not installed, HRR degraded), the dot renders as a small outlined ring instead of a filled dot, in `ink-text-dim`. This is a visible warning that this fact is not participating in the holographic algebra.

### 3.3 Tooltip on hover

```
┌────────────────────────────────────┐
│ f#0427 · user_pref · trust 0.70    │
│ "User prefers PyCharm over Cursor  │
│  for M3 debugging sessions."       │
│                                    │
│ ⊙ entities: pycharm, m3, debugging │
│ → closest: f#0891 (0.74), f#0221  │
│              (0.66), f#1102 (0.61)  │
│   retrieved 12×  helpful 3×        │
└────────────────────────────────────┘
```

- 240px wide, max 6 lines of content.
- Background: `ink-base` with 1px `edge-gold` border.
- Mono numerics (`0.70`, `0.74`), humanist text.
- 8px from cursor, follows with 60ms easing.
- 200ms delay before appearing (so the field doesn't strobe when the user moves the mouse across it).

### 3.4 Selection

- Click a dot → it pins in the Inspect pane. The dot gets a 1px `edge-gold` ring.
- Drag-select a region → a hairline `edge-gold-dim` rectangle, on release the Inspect pane shows aggregate stats for the selection.
- `Shift+click` → multi-select dots. Inspect shows aggregate.
- `Esc` → clear selection.

### 3.5 New-fact arrival (the live demo moment)

When a new fact arrives via WAL delta:

1. Compute its 2D position by `transformer.transform(new_vector.reshape(1, -1))`.
2. Spawn the dot at `(x, y)` with `opacity: 0, scale: 0.6`.
3. Animate to `opacity: 1, scale: 1` over 400ms with `cubic-bezier(0.2, 0.8, 0.2, 1)` (ease-out, no bounce).
4. Find the 5 nearest existing dots by raw cosine similarity.
5. For each, emit a gold ripple: a 1px `edge-gold` ring at the dot's position, expanding from `r=2` to `r=40` over 600ms, opacity from `0.4` to `0`. Stagger by 80ms.

When a fact's `trust_score` changes (via `fact_feedback`):

1. The dot's color animates from current saturation to new saturation over 600ms.
2. If the change crossed a threshold (e.g. crossed 0.5), a single 200ms `numerics` glow on the trust number in the Inspect pane.

When `bank_rebuild` is logged (the provider's `_rebuild_bank` runs after add/update/remove in a category):

1. Compute the centroid of all facts in that category.
2. Pulse that region: a 1.5s radial expansion of `edge-gold` at 8% opacity, then fade.
3. This is a *visible reminder* that the bundle just changed and the geometry is now slightly different.

### 3.6 The reason halo (when the Reason Workbench runs)

When the user invokes Reason:

1. Each selected entity gets a 16px-radius ring drawn in `edge-gold` at the centroid of its facts. The ring breathes (0.6 → 1.0 scale over 1.2s, repeat) until the workbench is closed.
2. Each fact that scores above the workbench's threshold (default 0.5) gets a 2px `edge-gold` ring for the duration of the workbench.
3. The math logs stream into the bottom of the field pane (not the stream footer) in mono, monospace 11px, `ink-text-dim`. Scrolls.

### 3.7 Camera controls

- Scroll wheel: zoom (centered on cursor). Range 0.5× to 8×. Default 1×.
- Click-and-drag on empty space: pan.
- `0` (zero): reset to default zoom/pan.
- `f`: fit all dots in view.
- `Space` then drag: pan with spacebar-held (the standard "hand" mode).

Zoom and pan never animate — they're instant. The animation budget is for *data* changes, not navigation.

---

## 4. Inspect pane (right column)

Single-fact focus:
```
INSPECT

f#0427
─────────────
USER_PREF · tags: editor, m3, pref

"User prefers PyCharm over Cursor
for M3 debugging sessions."

[ edit content  ]
[ edit category ▾]
[ edit tags     ]

trust      ▓▓▓▓▓▓░░░░  0.70
retrievals              12×
helpful                 3×

created   2026-06-30 14:22:11
updated   2026-07-01 09:14:02

entities
  ⊙ pycharm    ⊙ m3    ○ debugging

hrr_vector  8192 B (1024 × f64)
[inspect algebra]    [export fact]

[ 👍 helpful ]  [ 👎 unhelpful ]  [ delete ]
```

### 4.1 Header

`INSPECT` in 11px mono, `edge-gold`, letter-spacing 0.1em, uppercase. Below it, in 13px humanist: `f#0427` (the fact ID, in `numerics` color — the user learns that numbers are amber in this app).

### 4.2 Content

- Category chip: 10px mono, `edge-gold` border, transparent fill, padding 2px 6px. The chip's text color is the category's hue.
- Tags: comma-separated, 11px humanist, `ink-text-dim`.
- Content: 14px humanist, `ink-text`, line-height 1.5. Wraps. The "edit content" link (11px humanist, `edge-gold`) opens the content in an inline `<textarea>` (no modal).

### 4.3 Edit affordances

- **edit content**: in-place `<textarea>`, 14px, monospace, 6 lines visible, autosize. `⌘Enter` commits, `Esc` cancels.
- **edit category**: a select with the four categories. `user_pref / project / tool / general`.
- **edit tags**: in-place input, comma-separated.

### 4.4 Trust + retrieval

- Trust: a horizontal bar 160px wide, 8px tall. Fill is the category hue (so `user_pref` is gold, `project` is blue). Background: `rgba(255,255,255,0.06)`. The number is at the right of the bar, in 12px mono `numerics`.
- Retrievals / helpful: 12px mono `numerics`, with a `×` suffix to remind the user these are counts not percentages.

### 4.5 Timestamps

- 11px humanist, `ink-text-dim`. ISO format. Hover: full `ink-text`, shows relative ("3 hours ago") in a tooltip.

### 4.6 Entities

- Chips, each: 10px humanist, `edge-gold-dim` border, 2px 6px padding. Hover: full `edge-gold`. Click: filter the field to facts-with-this-entity (the same action as clicking in the Entities pane).

### 4.7 HRR vector

- 11px mono `ink-text-dim`: `hrr_vector  8192 B (1024 × f64)`.
- **inspect algebra**: opens the FFT inspector overlay (see §6).
- **export fact**: downloads a JSON file `{fact_id, content, category, tags, trust_score, retrieval_count, helpful_count, created_at, updated_at, entities: [...], hrr_vector_b64: "..."}` to `~/Downloads/holo_eye_fact_0427.json`.

### 4.8 Actions

- **👍 helpful** / **👎 unhelpful**: buttons, 11px humanist. `helpful` is `signal-add` border; `unhelpful` is `signal-remove` border. Both call the provider's `fact_feedback` action. The trust number animates to its new value.
- **delete**: button, 11px humanist, `signal-remove` border. Opens a confirmation modal (see §7.4).

### 4.9 Multi-select state

When multiple facts are selected, the pane shows:

```
INSPECT
12 facts selected

─────────────
mean trust    ▓▓▓▓▓▓▓░░░  0.68
total retrievals           47×
helpful                    11×

categories
  user_pref    ▓▓▓▓▓  5
  project      ▓▓▓     3
  tool         ▓       1
  general      ▓▓▓     3

[ bulk 👍 ]  [ bulk 👎 ]  [ bulk export ]
```

No edit/delete from multi-select. The user is in *observation* mode; editing is per-fact.

---

## 5. Stream pane (footer)

```
STREAM
16:42:08  fact_store(add)         "User prefers PyCharm over…"            ✓ 38ms
16:42:08  entity+1                pycharm → fact 0427                     ✓ 2ms
16:42:08  hrr_compute             fact 0427, 1024-d                        ✓ 4ms
16:42:08  bank_rebuild            cat:user_pref (38 facts)                ✓ 11ms
16:42:11  fact_store(probe)       "pycharm"                                ✓ 6ms
16:42:11  hrr_unbind              target=pycharm, key=ROLE_ENTITY          ✓ 1ms
16:42:11  ─ top 3 ─               0427 (0.91) 0891 (0.74) 0221 (0.66)      ✓
```

### 5.1 Format

Each line: `[time] [action] [detail] [✓/✗] [duration_ms]`.

- **time**: `HH:MM:SS` in 11px mono, `ink-text-dim`.
- **action**: 13px mono, `ink-text`. Recognized actions: `fact_store(add)`, `fact_store(search)`, `fact_store(probe)`, `fact_store(reason)`, `fact_store(contradict)`, `fact_store(update)`, `fact_store(remove)`, `fact_feedback(helpful)`, `fact_feedback(unhelpful)`, `entity+1`, `entity-1`, `hrr_compute`, `hrr_unbind`, `bank_rebuild`, `tool_call`, `tool_result`.
- **detail**: 11px humanist, `ink-text-dim`. The detail varies per action; see §5.2.
- **status**: `✓` in `signal-add`, `✗` in `signal-remove`. Empty for events that aren't tool calls.
- **duration**: 11px mono, `numerics`. Empty for events without measured duration.

### 5.2 Detail strings

| Action | Detail format |
|---|---|
| `fact_store(add)` | `"<first 60 chars of content>…"` (or `…` only if shorter) |
| `fact_store(search)` | `"<query>"` |
| `fact_store(probe)` | `"<entity>"` |
| `fact_store(reason)` | `"<entity1>, <entity2>[, <entity3>]"` |
| `fact_store(contradict)` | `"<topic>"` (or empty) |
| `fact_store(update)` | `f#<id> <field>=<new>` (e.g. `f#0427 trust=0.75`) |
| `fact_store(remove)` | `f#<id>` |
| `fact_feedback(helpful)` | `f#<id>` |
| `fact_feedback(unhelpful)` | `f#<id>` |
| `entity+1` | `<name> → f#<id>` |
| `entity-1` | `<name> ↗ f#<id>` |
| `hrr_compute` | `f#<id>, <dim>-d` |
| `hrr_unbind` | `target=<entity>, key=ROLE_ENTITY` |
| `bank_rebuild` | `cat:<category> (<n> facts)` |
| `tool_call` | `<tool_name> <args[:80]>` |
| `tool_result` | `<tool_name> ✓/✗ <duration_ms>ms` |
| `─ top N ─` | `f#<id1> (0.91) f#<id2> (0.74) f#<id3> (0.66)` (for `reason` results) |

### 5.3 Aging

The most recent line is at full `ink-text`. Lines fade toward `ink-text-dim` over 30 seconds, linearly. Lines older than 5 minutes are at full `ink-text-dim`. The user has *one* second of "I just saw this happen" before it recedes.

### 5.4 Capacity

Holds the last 200 events. New events push old ones out. Scrollable.

---

## 6. FFT inspector overlay (opt-in, power user)

Opened from the Inspect pane's `inspect algebra` button. A 560×420 modal that floats over the field.

```
┌─ ALGEBRA · f#0427 ────────────────────────────────────────────┐
│                                                                │
│  FACT PHASE SPECTRUM                                           │
│  ┌────────────────────────────────────────────────────────┐   │
│  │     ▄                                                    │   │
│  │    ██                                                    │   │
│  │   ███           ▄                                        │   │
│  │  █████        ▄ █                                        │   │
│  │ ███████     ▄ ███                                        │   │
│  │████████  ▄ ████████                                      │   │
│  └────────────────────────────────────────────────────────┘   │
│  0       256       512       768      1024  (frequency bin)    │
│                                                                │
│  ENTITY OVERLAY: ⊙ pycharm                                    │
│  Show: [✓] fact    [✓] entity:pycharm    [ ] bank:user_pref   │
│                                                                │
│  Composition:                                                  │
│    content × ROLE_CONTENT     (peak at bin 142)                │
│    pycharm × ROLE_ENTITY     (peak at bin 891)                │
│    m3 × ROLE_ENTITY         (peak at bin  77)                │
│                                                                │
│                                            [ close ]  esc      │
└────────────────────────────────────────────────────────────────┘
```

### 6.1 The plot

- A 2D line plot. X: frequency bin (0..1023). Y: FFT magnitude, normalized to [0, 1] per trace.
- Each trace is a 1px line in its color (the fact's category hue, the entity's hue, the bank's hue — three distinguishable lines).
- The peaks of each trace are labeled at the top with bin number and the component that contributes most to that bin.
- The user's current `category:user_pref` bank is also selectable; the bank's trace is in `edge-gold-dim` (it's a denser signal, so dim it).

### 6.2 Why this is honest

The bundled vector is `bundle(bind(content, ROLE_CONTENT), bind(entity, ROLE_ENTITY), ...)`. Each `bind` is phase addition. The FFT of the sum is *not* the sum of FFTs (circular convolution in time = element-wise multiplication in frequency). So the spectrum of the bundled vector is a true fingerprint of the *interference pattern* of the components. Showing it is a *literal* visualization of the algebra, not a metaphor.

A user looking at the spectrum and seeing three peaks (one for the content role, two for entity roles) is seeing the three bound components. They can toggle which entity is overlaid, see its spectrum change. They can hover a peak, see which atom contributed it. The math is real. The data is real. The plot is real.

### 6.3 The "inspect algebra" link in the Inspect pane

Small, 11px humanist, `edge-gold` underline on hover. It's labeled `inspect algebra` (lowercase, the way links are in this app). It only appears if `hrr_vector IS NOT NULL` for the selected fact — otherwise the message is `algebra unavailable · numpy not installed at agent side`.

---

## 7. Modals

### 7.1 Reason Workbench

```
┌─ REASON · ⊙ pycharm + ⊙ m3 ──────────────────────────────────┐
│                                                                │
│  probe_key   = bind(encode_atom("pycharm"), ROLE_ENTITY)      │
│             + bind(encode_atom("m3"),      ROLE_ENTITY)       │
│  bank_vec    = memory_banks[cat:general]                      │
│  extract     = unbind(bank_vec, probe_key)                     │
│                                                                │
│  results (12 facts, 0.5 threshold):                            │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ 1. f#0427  sim=0.83  trust=0.70  score=0.61            │   │
│  │    "User prefers PyCharm for M3 debugging sessions"     │   │
│  │ 2. f#0891  sim=0.71  trust=0.85  score=0.74            │   │
│  │    "M3 long-context works best with PyCharm's indexer…  │   │
│  │ 3. f#0221  sim=0.66  trust=0.50  score=0.33            │   │
│  │    "Hermes memory project was scaffolded in PyCharm…"   │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  threshold: [─────●─────] 0.5                                  │
│                                                                │
│                                       [ close ]  esc           │
└──────────────────────────────────────────────────────────────────────────────┘
```

- 720×520 modal, floats over the field.
- Header: `REASON · ⊙ entity1 + ⊙ entity2 + …`, 13px humanist, `ink-text`.
- Math block: 12px mono, `ink-text-dim`, monospace, with the actual provider arithmetic shown.
- Results: a scrollable list. Each row: 12px humanist, content; 11px mono `numerics` for the scores.
- Threshold slider: a horizontal bar with a 4px `edge-gold` thumb. Adjusting it filters the list live and re-renders the field highlights.
- `Esc` or `⌘.` to close.

### 7.2 Edit preview (when committing a fact update)

```
┌─ COMMIT EDIT · f#0427 ────────────────────────────────────────┐
│                                                                │
│  before                                                        │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ "User prefers PyCharm over Cursor for M3 debugging"     │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  after                                                         │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ "User prefers PyCharm for M3 debugging"                │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                │
│  predicted entities:  pycharm, m3 (debugging will be removed)  │
│  bank impact:          cat:user_pref · 38 facts · rebuilding   │
│                                                                │
│                                       [ cancel ]  [ commit ]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

- 560×340 modal.
- Two text blocks, "before" and "after", in 12px mono, `ink-text`. Diff is visible (chars removed in `signal-remove`, chars added in `signal-add`).
- Predicted entities: computed by re-running the provider's regex on the new content locally. 11px humanist, `ink-text-dim`.
- Bank impact: which category bank will be rebuilt, and the new fact count. 11px humanist, `ink-text-dim`.
- `commit` calls the provider's `fact_store(action=update, ...)`. The DB stays consistent because the provider's invariants are honored.

### 7.3 Delete confirmation

```
┌─ DELETE · f#0427 ─────────────────────────────────────────────┐
│                                                                │
│  "User prefers PyCharm over Cursor for M3 debugging"          │
│                                                                │
│  trust 0.70  ·  retrieved 12×  ·  helpful 3×                  │
│                                                                │
│  bank cat:user_pref will be rebuilt (38 → 37 facts)            │
│                                                                │
│  type 0427 to confirm:  [____________]                         │
│                                                                │
│                                       [ cancel ]  [ delete ]   │
└──────────────────────────────────────────────────────────────────────────────┘
```

- 480×260 modal.
- The fact's content in 12px humanist.
- Trust, retrievals, helpful in 11px mono `numerics`.
- The text input is a 6-character field. The `delete` button is disabled until the input matches the fact ID exactly.
- This is the modal that earns the user's trust. By being annoying.

### 7.4 No success toasts

The dot's animation, the field's ripple, the stream line, the numerics update — those *are* the success indicators. No toasts. No notifications. No "Saved!" popups. The app is a window into something that's happening; the something is its own notification.

---

## 8. Color & type tokens (the design system)

### 8.1 Colors

```css
:root {
  /* shell */
  --shell-glass-100: rgba(255, 255, 255, 0.04);
  --shell-glass-200: rgba(255, 255, 255, 0.08);

  /* interior */
  --ink-base:        #0a0a0c;
  --ink-surface:     #14141a;
  --ink-text:        #e8e6e0;
  --ink-text-dim:    #8a8780;

  /* accent */
  --edge-gold:       #c8a04a;
  --edge-gold-dim:   rgba(200, 160, 74, 0.35);
  --numerics:        #f4d27a;

  /* signal */
  --signal-add:      #7fae6e;
  --signal-remove:   #9b6b6b;
  --signal-warn:     #d97757;

  /* category hues (low chroma, deliberately quiet) */
  --cat-user_pref:   hsl(38, 65%, 55%);
  --cat-project:     hsl(210, 50%, 55%);
  --cat-tool:        hsl(0, 0%, 70%);
  --cat-general:     hsl(0, 0%, 50%);
}
```

### 8.2 Typography

```css
:root {
  --font-sans:    "Inter", "Söhne", "Optima", system-ui, sans-serif;
  --font-mono:    "JetBrains Mono", "Berkeley Mono", "IBM Plex Mono", ui-monospace, monospace;

  --text-xs:      11px;  /* labels, monospace captions */
  --text-sm:      12px;  /* secondary */
  --text-md:      13px;  /* body */
  --text-lg:      14px;  /* fact content */
  --text-xl:      16px;  /* modal headers */

  --leading-tight:  1.3;
  --leading-normal: 1.5;
  --leading-loose:  1.7;
}
```

### 8.3 Motion

```css
:root {
  --motion-instant:    0ms;
  --motion-fast:       120ms;   /* hover */
  --motion-base:       250ms;   /* edit commit */
  --motion-medium:     400ms;   /* new fact arrival */
  --motion-slow:       600ms;   /* trust change, ripple */
  --motion-bank:       800ms;   /* bank rebuild pulse */

  --ease-out:          cubic-bezier(0.2, 0.8, 0.2, 1);
  --ease-in-out:       cubic-bezier(0.4, 0, 0.2, 1);
  --ease-linear:       linear;
}
```

Reduced-motion users get all motion durations clamped to 0ms; the data still updates, but no animations play. This is a CSS media query, no JS.

---

## 9. Keyboard shortcuts (the cheatsheet, also in the status bar)

| Key | Action |
|---|---|
| `⌘E` | Edit the focused fact's content |
| `⌘R` | Open Reason Workbench (prompts for entities) |
| `⌘F` | Focus search (type to filter facts) |
| `⌘,` | Settings (theme, projector, half-life) |
| `⌘Q` | Quit |
| `F` | Focus a fact by content (typeahead) |
| `R` | Open Reason Workbench with the focused fact's primary entity pre-filled |
| `0` | Reset field zoom/pan |
| `Space + drag` | Pan field |
| `Shift + click` | Multi-select dots |
| `Esc` | Clear selection / close modal |
| `?` | Show keyboard cheatsheet overlay |

---

## 10. What this wireframe is not

- It's not a high-fidelity visual. It's a spec. The actual pixel values will be tuned in L2.
- It's not a feature list. The features were specified in `VISION.md`. This is the *layout* and *interaction* spec.
- It's not responsive. The app is a desktop window. Mobile is out of scope.
- It's not exhaustive of every edge case. When the user does something we didn't anticipate, the field reacts (their action is visible because it changes a dot), the stream logs it, and the Inspect pane shows the result. The system is *observable* end-to-end, which is what makes it safe to extend.


---

## D-0007 — Backup Memory feature (directed by Ben, 2026-07-02)

- Date: 2026-07-02 · Status: **directed by Ben** ("add some sort of 'backup
  memory' feature with a file picker/ability to put onto the mass storage drive")

### Decision
The Eye gets first-class memory backups:
- **RPC** `backup.create {dest_dir?, label?}` — consistent snapshots of
  `memory_store.db` + `eye_journal.db` via the sqlite3 backup API (safe while
  the gateway is live; no file copies of a hot WAL db), written to a
  timestamped folder with a `manifest.json` (counts, sizes, versions).
  Journaled as `source=eye, kind=backup`. `backup.list` enumerates existing
  backups across the known destinations.
- **GUI**: Backup modal (status-bar action) — destination presets
  (Mass storage → `/media/ben/Mass storage/agenticTinkering/claude/
  holographic-eye-backups/` per Ben's drive rules, and
  `~/.hermes/backups/holographic-eye/`), free-path input, existing-backup
  list. Native file picker arrives with the Tauri shell (P7).
- **Default destination**: Mass storage path when the drive is mounted,
  else the HERMES_HOME fallback.
- **Restore is deliberately cold**: no live-restore RPC in v1 — swapping a
  WAL database under an open connection risks corruption. Restore =
  stop gateway → copy back → start (documented in README; revisit later).

## D-0008 — Feedback round 1 (Ben, 2026-07-02 late) — applied

Ben's first hands-on pass produced 13 items; all applied same session:

1. **Pan fixed** — drag on empty space pans (§3.7); shift+drag = region
   select; space+drag pans anywhere. (Old build wrongly made bare drag a
   region select.)
2. **Text brightened** — `--ink-text-dim` #9fb3c2 → #b9cdda, text #eef8ff.
3. **⚙ Settings modal** — legend, terminology, projection refit + explained
   variance, attached session, performance numbers, token reset. Status bar
   right side simplified (refit/token moved inside).
4. **Trust lens** — click the status-bar trust sparkline → popover with
   +/− steppers, slider, show-≥ / show-< modes; non-passing dots fade to 7%;
   🔍 badge + threshold mark on the sparkline while active.
5. **Workbench loading state** — results=null until the RPC returns; never
   shows "nothing" while computing. (Read-only — cannot affect the agent.)
6. **Entity click always visible** — linked facts highlight instantly
   (pink rings + others dim to 12%), then probe results union in the
   structurally-hot set (sim>0.35, recovered from score/(trust)); math log
   narrates counts.
7. **/holo shows no localhost URL** (phone-readable); desktop access is
   `hermes holographic-eye gui`. Mobile web view deferred (would need LAN
   bind + auth story).
8. **Educational tooltips** — no-vector rings explain the algebra exclusion
   + backfill path; fact tooltips explain trust bands and recall counts;
   SNR ⚠ has a hover explanation; Help became a manual with legend +
   13-term glossary (shared with Settings).
9. **Ask-the-agent session targeting** — asks land in a stable
   `eye-console` session by default via X-Hermes-Session-Id (previously
   each ask spawned an anonymous api-* session); modal shows a target
   selector + the wrapper's live attached session, refreshed every 8s
   while open only; the server echoes the session actually used.
   Verified live.
10. **Latency** — measured: journal append was 2.5ms/op (fsync-bound) →
    `PRAGMA synchronous=NORMAL` under WAL → **0.107ms/op**; image capture
    0.03ms; prefetch journaling moved off the critical path (thread) →
    **~0ms added to turns**. Total wrapper overhead ≈0.1–0.2ms per memory op.
11. **Confidence review** (three least-confident areas re-audited):
    `mutations.undo` — rewrote the creation-branch conditional (relied on
    `or/and` precedence; dedupe-adds now refuse cleanly instead of
    rewriting an identical image); `control.py` WS — send timeout added
    (stalled client can't wedge its thread), close frames echoed per
    RFC 6455, continuation frames explicitly ignored; `images.py` — audit
    found id-reuse safe (AUTOINCREMENT never reuses), name-based re-resolve
    fallback correct; no change needed.
12. **Chiseled buttons** — carved-slab styling: lit top bevel, shadowed
    base, pressed-in active state; semantic border tints kept.
13. **Pixel blossoms** 🌸 — pixel-art flower bed along the bottom edge
    (one-time 1.4s bloom animation, reduced-motion aware) + climbing vines
    on both window edges; stream got bottom padding so the last line stays
    readable. Blossom palette: pink petals, gold hearts, green stems.

## D-0009 — Feedback round 2 logged; three polish priorities chosen (2026-07-02)

- Status: **logged, deliberately deferred** (Ben: "not going to have you fix
  everything here right now").
- Full table with root causes: `feedback/2026-07-02-round2.md` (+ screenshots).
- Chosen priorities (stability + clarity, polish-only): **P-1** render
  discipline & idle cost (dirty-flag canvas → <1% idle CPU; remove
  gradient-banding "circles"; one bottom info lane; scrollbar gutter);
  **P-2** affordance truthfulness (multi-entity highlight set, chevron
  discloses-or-dies, lens toggle); **P-3** one manual + honest settings
  (dedupe ?/⚙, plain-language settings, glossary as the single canonical copy).
- Delight backlog: flower variety + settings toggle, pixel cottage
  bottom-right, font-size setting.
- Same session: project pushed to GitHub (private — the Field and mockup
  screenshots contain Ben's real memory contents).
- **Applied next session (2026-07-03) — see D-0010.**

## D-0010 — Feedback round 2 applied: render discipline, affordance truth, one manual (2026-07-03)

- Status: **applied + verified live** (frontend-only; no server code changed,
  no gateway restart needed; both acceptance harnesses re-run ALL-PASS).
- Verification: Playwright (system Chrome, headless) against the deployed GUI
  with a `clearRect` hook counting real canvas draws.

1. **Dirty-flag rendering (P-1, r2 #7)** — the unconditional 60fps rAF loop is
   gone. `Field.requestDraw()` coalesces one frame per change (camera, hover,
   data, selection, highlight, lens, halo) and keeps itself alive only while
   effects animate or a halo breathes. New store topics: `trustlens`, `halo`;
   a `ResizeObserver` covers window/pane resizes; the 200ms tooltip delay is a
   timer, not a poll. **Measured: 0 draws in 5s idle** (was ~300); pan = 8
   draws then back to 0; resize = exactly 1 draw.
2. **Banding gradient removed (r2 #1)** — the radial "depth" gradient banded
   into concentric rings on near-black displays; the Field keeps only the
   hairline grid.
3. **One bottom info lane (r2 #2)** — the mathlog now sits above the
   no-vector strip (`bottom: 30px`) on its own background, hides itself when
   empty (`:empty`); the strip owns the bottom edge. They can no longer
   overlap at any size.
4. **Scrollbar gutter (r2 #8)** — `scrollbar-gutter: stable` on `.pane`; tab
   switches no longer shift content.
5. **Multi-entity highlight is a real set (P-2, r2 #3)** —
   `store.highlightedEntities: Map<name, Set<fact_id>>`; every click toggles
   membership; the field rings the union; all active rows show active state;
   esc clears all. Probe results land per-entity (stale results for a
   since-dropped entity are discarded).
6. **Chevron discloses (r2 #4)** — ▸ unfolds that entity's facts inline
   (click one → selects it in the Field); rotation now means "open", not
   hover decoration. No dead affordances.
7. **Trust lens toggles predictably (r2 #6)** — spark click is a true toggle;
   the outside-click dismiss uses `closest("#spark")` (the old `id` check
   broke on the sparkline's child `<i>` bars → close-then-reopen); the
   mousedown listener is removed on every close path (was leaking one per
   open); mode buttons update in place. Lens changes emit `trustlens`.
8. **Honest probe feedback** — found while verifying: the inner provider's
   `probe()` takes ~4s (it re-encodes `encode_text(content)` for all 518
   facts per call — upstream `plugins/memory/holographic/retrieval.py`, a
   clean cache candidate, out of scope here). The mathlog now narrates
   immediately ("running… · N linked ringed") and updates when the probe
   returns — the UI never sits silent.
9. **One manual, honest settings (P-3, r2 #5/#12)** — ? is the manual
   (keys + legend + glossary, single canonical copy); ⚙ holds only real
   settings, each with a one-sentence plain-language explanation, and links
   to the manual.
10. **Text size setting (r2 #11)** — all font sizes converted to rem
    (13px = 1rem root); ⚙ appearance → 85%/100%/110%/125%, applied via root
    `font-size`, persisted in `localStorage.eyeUiScale`.
11. **Pixel garden variety + toggle + cottage (r2 #9/#10)** — flowerbed tile
    widened to six species (pink five-petal, bud, rose, gold daisy, bluebell,
    white daisy) + grass tufts; a pixel cottage with a lit gold window sits
    bottom-right (flowers grow in front of its doorstep); ⚙ appearance →
    "pixel garden" checkbox (`body.no-garden`), persisted in
    `localStorage.eyeGarden`.

---

# PART 7 — Decision log

(Statuses as of 2026-07-02 evening: D-0001 / D-0003 / D-0005 **ratified by Ben**
("I approve the three decisions listed in the plan", 2026-07-02); D-0002 superseded;
D-0004 / D-0006 applied.)


---

## D-0001 — Staging model: journal + undo (optimistic), hard gate rejected

- Date: 2026-07-02 · Status: **ratified by Ben, 2026-07-02** ("I approve the three
  decisions listed in the plan")

## Decision
Default mode is `journal`: every agent write applies immediately and is journaled with
full before/after images; review is asynchronous curation with one-click undo.
`quarantine` (new facts land below min_trust until approved) is specced as an optional
per-category policy but **built only on demonstrated need** (Q5). A hard approval gate
is **rejected and will not be built**.

## Why
A hard gate breaks the agent's memory coherence: store → probe → missing → re-add /
distrust. That injects bugs into the system we're trying to debug. The provider already
has a native soft gate — trust filtering at min_trust 0.3 — and the live DB shows the
trust loop is unused (505/516 facts at 0.5): the observed problem is *curation absence*,
not *write danger*. Journal+undo keeps agent behavior bit-identical (invariant I2) while
giving the human total post-hoc control (I3/I4).

## How to apply
Wrapper delegates first, journals always; undo is an RPC that restores before-images
via the Python layer. Quarantine, if ever enabled, is a trust operation — never a
withheld write.


---

## D-0002 — GUI stack: Elixir / Phoenix LiveView; interception layer is Python by physics

- Date: 2026-07-02 · Status: **SUPERSEDED by D-0005** (Tauri + TS,
  dual-serve) after Ben's draft docs surfaced the linux-native/.deb requirement
  and made the canvas Field the centerpiece. The Python-by-physics half stands.

## Decision
- Interception/control plane: **Python** — non-negotiable; it implements the
  `MemoryProvider` ABC inside the Hermes process.
- GUI client: **Elixir + Phoenix LiveView**, browser-based, its own process.
- Zig: rejected for the GUI. Rust/Tauri: runner-up, revisit only if a native-binary
  desktop shell becomes a real requirement.

## Why
The "cool language" budget only buys the client, and it should buy something
load-bearing: LiveView's server-push realtime model is a 1:1 match for a WS event
stream console — the Live Wire pane is nearly free. Browser delivery means the console
is reachable from any device on the LAN (matches Ben's Telegram-first, multi-device
agent usage). Tauri would spend the coolness on a native shell while the UI ends up in
TS anyway; Zig has no GUI story worth the grind.

## How to apply
`build/studio_gui/` Phoenix app; Req for RPC, WS client → Phoenix.PubSub → LiveViews.
No direct SQLite writes ever; reads only for the optional stats page (I5/I6 fidelity
rules in PART 4 (architecture)).


---

## D-0003 — v1 instrumentation scope

- Date: 2026-07-02 · Status: **ratified by Ben, 2026-07-02**

## Decision
v1 journals/surfaces: (a) all `fact_store` actions + `fact_feedback`, (b) prefetch
visibility — each turn's query and the exact injected memory block, (c) the silent
write paths — `on_memory_write` mirrors and session-end auto-extract.
Deferred past v1: `memory_banks` surface (7 banks exist, exotic), entity-graph
visualization, multi-profile support, upstream PR, raw SQL console.

## Why
(a) is the core loop; (b) is the highest debugging value per line of code ("what did
the agent actually see"); (c) is where junk enters unobserved today — the bundled
plugin swallows mirror errors (`except Exception: pass`). The deferred items are
attractive but don't iron bugs: graph viz is decoration until curation works; banks
are unused in practice; multi-profile serves nobody on a one-profile install.

## How to apply
Interception points and journal `source` values in PART 4 (architecture) C1/C2. Entity
merge/dedupe stays IN scope (P5) — it's curation, not decoration: 620 regex-minted
entities guarantee junk.


---

## D-0004 — Integration of Ben's three draft docs (Holographic Eye)

- Date: 2026-07-02 · Status: applied
- Inputs: `VISION.md` (44KB), `WIREFRAME.md` (31KB), `RISKS.md` (20KB), drafted
  2026-07-01 for an M3-contest context; reviewed after this tree's own plan existed
  (deliberate ordering, per Ben). Originals archived to
  `~/Documents/📥 Inbox/HolographicEye-drafts/`.

## Verdicts

**VISION.md — PASS with architecture replacement.** Adopted: the name (**The
Holographic Eye**), L0→L1→L2 layer ordering (substrate → control surface → shell),
the Field (2D projection of real HRR vectors — upgraded from "deferred graph viz"
to centerpiece pane), the Reason Workbench, the FFT inspector (opt-in), the edit
safety model (impact-preview, typed-ID delete, no silent writes, no success
toasts), the aesthetic thesis (→ PART 2 (Blossom)), §9 success narrative. Its HRR
math exposition verified true against `holographic.py`. **Rejected:** the entire
observer-only substrate — WAL-tailing, `agent.log` parsing, vendored HRR mirror,
MCP write proxy — superseded by the wrapper provider, which delivers lossless
events and real-code previews for free; notably RISKS.md's own analysis (Risk 4)
concludes the observer path collapses into "install a plugin anyway". **Retired:**
contest framing, M3 branding, the 2-day constraint.

**WIREFRAME.md — PASS, adopted nearly verbatim** → `PART 6 (UI spec)` with an
adaptation header (event source, write path, naming, projector). The design-token
system (§8) is canonical.

**RISKS.md — PASS as risk input.** Risks 2, 4, 7 and the drift half of 8:
structurally eliminated by the wrapper. Risk 1 (UMAP transform on phase vectors):
carried — PCA default, UMAP opt-in. Risk 3 (NULL hrr_vector): carried — 7 such
rows exist today; add a journaled `backfill` RPC. Risk 5 (contest): retired.
Risk 6: Cinnamon/Mint confirmed from the live environment ("blossom theme" still
an open question for Ben). Risk 8's honesty rule adopted: the Workbench previews
*the recall, not the answer*. The claimed upstream prefetch bug (#31263) does not
match this fork — core calls `provider.prefetch` (`agent/memory_manager.py:507`);
P1's journal verifies empirically.

**Keyword bank (RISKS.md Part 2)** — Ben's own requirements, folded into
PART 2 (Blossom): linux native, .deb, bundled deps, app icons, clean
install/uninstall, Cinnamon harmony, glass, animated-but-careful, accurate,
readable technical density.

## Renames applied
Working title Holographic Studio → **The Holographic Eye**; wrapper provider
`holographic-eye`; journal `eye_journal.db`; token file `eye_token`.


---

## D-0005 — GUI stack amendment: Tauri (Rust) shell + TS canvas frontend, dual-serve

- Date: 2026-07-02 · Status: **ratified by Ben, 2026-07-02**
- Supersedes D-0002 (Elixir LiveView recommendation).

## Decision
- Frontend: TypeScript + Canvas2D (WebGL only if profiling demands), one static
  bundle, no framework lock-in mandated by this decision.
- Shell: **Tauri (Rust)** — native window, `.deb` via tauri-bundler, app icons,
  `.desktop` file, Cinnamon-friendly chrome.
- Dual-serve: the Python control plane can serve the identical frontend bundle
  over LAN HTTP, so the browser-console mode from 0002 survives as a free extra.
- Elixir/LiveView: demoted to alternative; revisit only if Ben prefers BEAM after
  reading this.

## Why (what changed since 0002)
Two signals from the draft-doc integration: (1) Ben's own keyword bank demands
**linux native, .deb, app icons, clean install** on a now-confirmed Mint/Cinnamon
desktop — Tauri satisfies that natively; a LiveView browser app doesn't, and
packaging BEAM releases as .deb is joyless. (2) The Field — now the centerpiece —
is a canvas-heavy *client-side* rendering problem; LiveView's server-push
advantage doesn't apply to it (it would need a JS canvas hook anyway), and the
control plane already speaks WS directly to any client. Rust keeps the
"cool language" budget spent on something load-bearing (the shell, the WS/RPC
client, packaging); Zig remains rejected.

## How to apply
`build/eye_frontend/` (TS, canvas field, panes per PART 6 (UI spec)) +
`build/eye_shell/` (Tauri). Control plane serves the same bundle at `/` for LAN
access. P7 packaging targets Mint 22 (.deb), icons + desktop entry per keyword
bank.


---

## D-0006 — Blossom resolved: the Eye adopts Ben's Blossom theme

- Date: 2026-07-02 · Status: applied (Ben's direction, verbatim: "We need icons
  for the blossom theme, symbols, custom everything. … it's a theme we made and
  there's also blossom-shell that is zsh")

## Decision
The Eye's visual identity is Blossom (`~/Dev/ClaudeWorkspace/blossom/`): its
palette, its pink/gold/red semantic rule, and its generated-SVG icon language.
Full token remap and custom icon/symbol set specced in PART 2. The draft docs'
gold-centric focus color is re-routed to pink (pink = acting on); gold is
reserved for reference markers (thresholds, min_trust line, warnings, "what the
agent recalled").

## Why
It's Ben's existing system-wide design language — desktop (Cinnamon/GTK/icons)
and shell (blossom-shell zsh). The Eye should feel native to that desktop, not
introduce a third language. This also closes RISKS-draft Risk 6 (aesthetic
portability): the target is Ben's Mint/Cinnamon + Blossom environment
specifically, not generic OSes.

## How to apply
PART 2 token remap at P3 (frontend tokens from day one — cheap), full L2 polish
+ icon generation at P7, reusing the `blossom/tools/blossom_icons.py` pattern.
