# Memory editor audit for Holographic Eye 1.3

Date: 2026-09-06. Status: source audit and design proposal, not implementation approval.

## Scope and result

A unified editor can expose content, category, tags, and trust without new memory fields.
The current API already accepts a combined update. It does not guarantee an atomic save across all derived state and the journal.
It also has no stale-edit precondition. Those limits must remain visible until separately approved backend work closes them.

This audit read repository files and the delegated provider's Python source. It did not open a database, call an RPC, launch a GUI, or execute tests.
Only this document was written. The parent owns feedback-ledger changes. No provider, application, retrieval math, or live data changed.
RepoWise indexing was not run because this bounded read-only pass permits only the requested document output.

Version note: the current frontend work is the 1.3 planning baseline, not proof of an installed 1.3 backend.
`build/eye_provider/__init__.py:38` still declares `1.1.0`. Runtime versions were not queried.

## Source map

- `build/eye_frontend/src/panes.ts:530-744`: Inspect, content entry, metadata prompts, trust, bulk feedback, and undo selection.
- `build/eye_frontend/src/modals.ts:288-347`: server preview and explicit commit modal.
- `build/eye_frontend/src/api.ts:144-267`: timeouts, mutation acknowledgments, and duplicate suppression.
- `build/eye_provider/rpc.py`: parameter validation, dispatch, structured reads, and journal availability checks.
- `build/eye_provider/mutations.py`: preview, all writes, compensation, and undo conflict checks.
- `build/eye_provider/images.py`: exact row image, optional register, links, and restore helpers.
- `build/eye_provider/journal.py`: separate journal database, append, undo marking, retrieval counts.
- `build/eye_provider/control.py:209-262`: exposed statistics and runtime parameter subset.
- `build/eye_provider/explain.py`: projection, reason explanation, and spectrum reads.
- Delegated source, read only: `/home/ben/.hermes/hermes-agent/plugins/memory/holographic/{__init__,store,retrieval}.py`.
- Requirements: repository `PLAN.md`, `FEEDBACK.md`, and `AGENTS.md`; house `ben-context-standards`, `ben-ui-design`, and `agent-cli-standard` skills.

## Existing workflow

Inspect shows Identity, Evidence, and Actions. Content, category, and tags each have separate edit links.

- Content becomes a six-row textarea. Ctrl/Meta+Enter requests a preview. Escape redraws Inspect. There is no visible textarea Save or Preview button.
- Category opens a native `prompt()` with category suggestions embedded in text. Tags use a separate comma-separated prompt.
- Each change opens the same preview modal, but the entry points collect only one field at a time.
- The preview shows before/after content, changed category, new tags, predicted entities, removed entity names, and bank impact.
- Commit sends `fact.update`. The button disables while waiting and stays disabled after an unknown outcome.
- The trust slider writes immediately on `change` through `fact.trust_set`. Dragging changes its numeric readout before the write.
- Helpful and unhelpful buttons write immediately. They are not equivalent to setting trust because helpful feedback changes a counter.
- Multi-selection offers feedback, export, and Ask the Agent. Bulk feedback runs separate calls and silently ignores each failure.
- The backfill button inside one fact calls global `backfill_vectors`, affecting every fact with a NULL vector.
- Inspect Undo searches only the latest 400 journal events and matches request/response fact IDs. It can miss entity operations affecting the fact.

The current renderer guards against an older fact response replacing a newer selection. The preview also guards request order and modal lifetime.
Neither guard protects the stored fact against edits made after the preview. There is no durable per-fact draft model in these handlers.

## Exact fact property inventory

`fact.get` accepts positive integer `fact_id` and optional boolean `include_vector`.
Its fact object contains the following fields. These are API fields, not suggested new schema.

| Property | Read | Existing write path and boundary |
|---|---|---|
| `fact_id` | Always | Assigned by add. Not directly editable. |
| `content` | Always | `fact.add`, `fact.update`. Nonempty string required. Store strips leading/trailing whitespace. Unique content can reject a conflicting update. |
| `category` | Always | Add/update accept any nonempty string. No Eye enum. Preserve custom categories. Default on add is `general`. |
| `tags` | Always | Add/update accept a string, including empty string to clear. Default on add is empty. Convention is comma-separated text, not a JSON array. |
| `trust_score` | Always | Update accepts finite numeric `trust_delta`, not `trust_score`. `fact.trust_set` accepts finite `trust`. Store clamps trust to [0,1]. Feedback changes it indirectly. |
| `retrieval_count` | Always | No direct setter. Stored provider counter, not journal count. |
| `helpful_count` | Always | No direct setter. `fact.feedback(helpful=true)` increments it by one. False does not decrement it. |
| `created_at` | Always | No direct setter. |
| `updated_at` | Always | No direct setter. Update/feedback change it, including a same-value update. |
| `links` | Always, list of `{entity_id,name}` | No per-fact link assignment endpoint. Content edits re-extract links. Entity operations can affect many facts. |
| `hrr_vector_b64` | With `include_vector=true`, nullable | No raw vector setter. Derived by provider content/entity operations. Global backfill fills NULL vectors. |
| `vector_bytes` | Without `include_vector=true` | Derived display value, not editable. Current base64 length formula is approximate and can include padding overhead. |
| `journal_retrievals` | Added by `fact.get` | Derived count. Journal failure falls back to zero without a fact-level availability flag. Not editable. |
| `register` | Only if `fact_register` table exists, nullable | Entire optional row returned as a dictionary. No register edit endpoint. Column names are not fixed by Eye. |

The optional register is deliberately not promoted into editable controls. The test fixture has `fact_id`, `register_affinity`, `method`, and `updated_at`.
That fixture is not evidence of the current live schema. This audit did not query it.

Other read representations differ:

- `list` returns the nine scalar fact columns above, without vector, links, or register.
- `field.projection` adds `x`, `y`, `has_vector`, and entity-name strings. Its `retrieval_count` is the maximum of stored and journal-observed counts.
- Search/reason results are provider retrieval results, not complete fact edit images. Fetch `fact.get` before editing.
- `fact.spectrum` exposes derived spectrum traces and composition. It is not a vector editor.
- `entities.list` and `entity.get` expose entity identity, type, aliases, timestamps, and linked facts.
- `entity.alias` can change `name`, comma-separated `aliases`, and `entity_type`. Merge/remove have broader effects and belong in a separate entity workflow.

### Mutation contracts

- `fact.add`: `content`, optional `category`, optional `tags`. No initial trust argument. Uses provider default trust. Duplicate content returns `deduped`.
- `fact.update`: `fact_id` plus at least one of `content`, `category`, `tags`, `trust_delta`. Omitted fields stay unchanged.
- `fact.preview_update`: `fact_id` plus at least one of `content`, `category`, `tags`. No trust preview support.
- `fact.trust_set`: `fact_id`, `trust`. Converts absolute target into a delta against the current row under the Eye operation lock.
- `fact.feedback`: `fact_id`, boolean `helpful`. Current provider uses +0.05 for helpful and -0.10 for unhelpful.
- `fact.remove`: `fact_id`. Separate destructive action, not a blank-content save.
- `undo`: positive `event_id`. No redo endpoint.

The validator does not reject all unknown keys. An unrecognized field can be ignored when a recognized field is also present.
Do not infer editability from a successful request with extra keys.

## Retrieval parameters: exact scope

The Eye read passthrough calls the inner provider's `fact_store` handler. It does not implement a second retrieval engine.
The following parameters affect only that query. They do not save provider defaults.

| Method | Effective request controls | Default behavior |
|---|---|---|
| `search` | required `query`; optional `category`, `min_trust`, `limit` | limit 10; threshold from provider `_min_trust` |
| `list` | optional `category`, `min_trust`, `limit` | limit 10 through handler; threshold 0.0 |
| `probe` | required `entity`; optional `category`, `limit` | limit 10 |
| `related` | required `entity`; optional `category`, `limit` | limit 10 |
| `reason` | required nonempty string list `entities`; optional `category`, `limit` | limit 10 |
| `contradict` | optional `category`, `limit` | limit 10 |
| `reason.explain` | required nonempty `entities`; optional `category`, `limit` | limit 12; provider explanation, not a parameter editor |

The common validator accepts finite `min_trust` for all six passthrough actions, but only search/list consume it.
Do not show a working threshold slider for probe, related, reason, or contradict.
Optional category must be nonempty when supplied. Omit it for all categories. Limits must be positive integers.
The API accepts finite thresholds outside [0,1], although a normal UI can guide entry within the trust range.

Persistent provider settings have a different boundary:

| Setting | Available through Eye reads | Writable through Eye RPC |
|---|---|---|
| `min_trust_threshold` | Effective `_min_trust` as `stats.min_trust` | No |
| `hrr_dim` | `stats.hrr_dim`, projection/spectrum metadata | No |
| `hrr_weight` | No current dedicated value read | No |
| `temporal_decay_half_life` | No current dedicated value read | No |
| `default_trust` | No current dedicated value read | No |
| `auto_extract` | No current dedicated value read | No |
| `db_path` | No current configuration getter | No |

The wrapper delegates `get_config_schema()` to the provider, but does not expose it as an Eye RPC.
That provider schema advertises db_path, auto_extract, default_trust, and hrr_dim only.
The provider also loads threshold, weight, and decay settings from configuration. This is not permission to edit that configuration.

The Field trust lens is local visual filtering, not stored trust and not the provider recall threshold.
Keep all three names distinct: **Fact trust**, **Query minimum trust**, and **Field trust filter**.

## Atomicity, conflicts, and partial failures

### What one Save currently guarantees

A combined `fact.update` is one Eye operation and normally one journal event.
The wrapper uses a shared in-process operation lock keyed by database path. Wrapper agent writes also use it.
It does not lock unrelated external processes. The preview and ordinary structured reads do not take this operation lock.

The provider's `update_fact` commits the scalar row first. It then changes entity links, commits again, recomputes the vector, and rebuilds a bank.
Eye additionally rebuilds the old category bank when category changes. It appends the journal event afterwards.
Thus one RPC is not one all-or-nothing database transaction. A derived-state failure can leave committed content without completed vectors or banks.
Fact update has no general compensation block. Add, remove, backfill, and undo also have multi-stage boundaries.

### Stale edit and preview

There is no expected revision, expected before-image, or preview token in `fact.update`.
A later content edit can be overwritten by an older draft. Sending only changed fields reduces collateral overwrites but does not eliminate conflicts.
`updated_at` has timestamp granularity and same-value changes. It is not a reliable revision token.

Preview returns text/category/tags before and after, extracted entity names and existence, removed names, and bank counts.
It does not reserve that state, detect duplicate-content conflicts, preview trust, or calculate a future retrieval ranking.
It uses current store helpers. Alias resolution and intervening entity changes can still make the final linked names differ.
A content preview can show untrimmed draft text although the store strips it on save.
Preview bank counts include all category facts, while actual banks count only facts with vectors. Treat them as predicted category sizes, not exact bank membership.

### Journal and outcome

Eye checks journal availability before mutation. That check cannot guarantee the later append succeeds.
The memory store and journal are separate SQLite databases. Journal uses WAL with `synchronous=NORMAL` when available.
There is no cross-database commit or crash-proof claim covering both files.

If a successful mutation loses its append, the server returns `ok=false`, `committed=true`, `journaled=false`.
The client treats missing/invalid positive event acknowledgments as unknown. It does not currently retain the complete structured error in `RpcError`.
It also classifies ordinary mutation rejection bodies as unknown, conservatively preventing a retry.

Mutation calls time out after 30 seconds without aborting the request. A server can commit after that deadline.
Identical pending/unknown requests share a promise for this page lifetime. A reload, a different payload, or another client bypasses that protection.
This is not server idempotency. An automatic retry can duplicate feedback or apply a trust delta twice.

Bulk feedback is not atomic. It can commit some facts and fail others without reporting which ones failed.
A future editor must not copy that silent partial-failure behavior.

### Undo is conditional, not universal rollback

Undo compares current recorded fields against the event after-image, ignoring created/updated timestamps.
It also rejects later overlapping resource events, including same-value and B-to-C-to-B changes.
Completed later change/undo pairs can be ignored, enabling reverse-order undo.
It rejects already-undone events, undo-of-undo, empty operations, and duplicate adds that changed nothing.

Images preserve scalar columns, vector bytes, links, and optional register rows. Banks are rebuilt rather than restored byte-for-byte.
Entity mutation paths attempt compensation after failures. Compensation itself can fail, and errors report that possibility.
Restore helpers commit per object. Undo append and `mark_undone` are separate commits after state restoration.
A crash or append/mark failure can therefore leave restored memory without a complete undo receipt.

The UI should show the selected event and its eligibility, not promise that every historical change is always reversible.

## Proposed friendly editor

This section is a proposal only. No application or API write is authorized by this audit.

Use one **Edit memory** surface tied to a fact ID. Keep the read-only Inspect view and its back/forward history.
Use a stable draft with initial values, current values, changed-field flags, validation, preview state, and save state.
Do not replace an active draft when live data refreshes. Mark incoming changes beside the draft.

### Content

- Large labelled multiline **Memory text** field. Preserve line breaks and Unicode.
- Visible **Preview changes**, **Save changes**, and **Cancel** controls. Ctrl+Enter can remain a shortcut, not the only route.
- Show a before/after text diff. Explain whitespace trimming before saving.
- Keep validation beside the field. Example: “Memory text is empty. Add text, or use Delete memory.”

### Metadata

- **Category**: editable combobox with existing categories and the current exact value. Allow custom categories.
- **Tags**: labelled comma-separated text input. Empty means clear tags. Do not silently normalize or deduplicate strings.
- **Fact trust**: numeric entry plus synchronized slider, staged until Save. State the range and show current and draft values separately.
- Keep Helpful/Unhelpful separate from the draft. Explain their counter effect. Do not silently turn feedback into trust-setting.

### Advanced and evidence

- Read-only ID, timestamps, stored retrieval count, journal-observed retrieval count, helpful count, entity links, and vector presence.
- Show optional register data as read-only structured data when returned. Do not invent register controls.
- Link to algebra and entity details in persistent click-to-dismiss popouts.
- Keep global backfill outside the per-fact Save flow. Label it “Backfill all missing vectors” and show its real scope.
- Put query controls in a separate **Try recall** section with method-specific inputs from the table above.
- Show actual current-provider recall only. Do not call it a post-save simulation or preview of changed retrieval weights.
- Display exposed provider settings read-only. Mark missing configuration values unavailable, not zero or guessed defaults.

### Preview and Save behavior

1. Fetch a complete fact image before starting a draft. Do not edit from a projection fallback as if it were fresh.
2. Validate locally, then request server preview for changed content/category/tags.
3. Show changed metadata, predicted entity changes, and bank impact beside the text diff.
4. Keep preview inside the editor. Do not require a second modal approval simply because editing is powerful.
5. Disable duplicate submission while Save runs. Keep the draft until a verified result arrives.
6. On success, show the journal event and an Undo action inline. Refresh the saved image and related views.
7. On unknown outcome, preserve the draft and show “Save outcome unknown. Inspect current state and journal before retrying.”
8. On navigation, retain the draft or offer explicit discard. Never save on blur, slider release, Escape, or selection change.

Use sharp borders, token-driven Blossom-family themes, a dimensional primary Save button, and flat detail sections.
Use visible keyboard focus, native labels, accessible status announcements, narrow-window stacking, and no rounded status pills.
Reference popouts persist until dismissed. No decorative warning boxes or success toasts.

### Important backend dependency: combined trust

Content/category/tags can already share one `fact.update` call. A numeric **trust delta** can join that same call today.
An absolute trust target cannot join it directly. Converting a staged absolute target into a delta from the fetched value has a stale-read race.
Calling `fact.update` followed by `fact.trust_set` creates two events and a partial-success boundary.

Preferred proposal: add an optional absolute `trust` field to a conflict-checked combined update, mutually exclusive with `trust_delta`.
Compute its delta under the operation lock using the existing provider method. Do not change retrieval math or feedback semantics.
Until that proposal is approved, either label the staged control as a relative **Trust adjustment**, or keep absolute trust as an explicitly separate save.
Do not advertise an atomic absolute-trust-and-content Save using two calls.

## Proposed API work, not authorized changes

1. Add a conflict precondition to combined update. Prefer a server-issued revision or complete version token with defined scope.
   Compare it under the operation lock. Return current state and a structured conflict without applying changes.
   Include shared entity changes that affect a fact. Do not use timestamps alone.
2. Add absolute trust to that combined update and extend preview to disclose its exact effect.
3. Define complete failure outcomes for validation rejection, conflict, committed-but-unjournaled, derived-state failure, and unknown transport outcome.
   Preserve those outcomes in the client instead of reducing all mutation errors to one category.
4. Add durable request identity/result lookup if safe retry after disconnect is required. Page-local duplicate suppression is insufficient.
5. Design all-or-nothing derived-state handling separately. Existing store commits prevent a trivial outer transaction from making Save atomic.
   Consider a provider-supported transaction or verified compensation, with explicit crash and journal guarantees. Neither exists by adding a UI button.
6. Add a fact-scoped event lookup/undo eligibility read if the new UI promises complete history. A 400-event client scan cannot fulfill that promise.
7. If Ben wants persistent retrieval settings editing, propose a separate config API with an exact field schema and lifecycle semantics.
   Specify validation, backup, atomic file replace, rollback, restart needs, and in-memory application before exposing any setter.
8. Publish a strict machine-readable RPC schema and structured errors with recovery guidance. Current validation is executable Python, not a complete strict JSON schema.
   The plugin CLI also lacks the full house envelope/schema contract. Record this as follow-up within this read-only boundary, not permission to retrofit it now.

## Existing test evidence and missing proof

These are source-inspected tests, not tests run by this audit.

| Test source | Existing coverage |
|---|---|
| `build/verify/p2_control.py:210-255` | Fact/entity/backfill undo roundtrips, combined text/category/tags update, preview entity names against committed links. |
| `build/verify/test_backend_edges.py` | Empty/malformed parameters, Unicode and large payloads, numeric trust delta, duplicate add undo refusal, append loss, unavailable journal, shared operation locks, concurrent journal images. |
| Same, lines 453-574 | Same-value/ABA undo conflict, timestamp exclusion, reverse-order undo, register restore, entity compensation. |
| `build/verify/test_transport.cjs` | Unknown mutation acknowledgments and repeat suppression, successful request reuse/release, read/auth failure behavior. |
| `build/verify/gui_edge.cjs` and `test_responsive_views.cjs` | Synthetic RPC fixtures include preview behavior and current responsive/transport surfaces. Not proof of a unified editor. |

Required candidate-only acceptance tests for implementation:

- Edit content/category/tags together. Save emits one combined update and one expected event. Cancel emits no write.
- Trust staging emits no request until Save. Verify relative versus absolute semantics explicitly, including concurrent updates.
- Preserve custom categories, empty tags, multiline Unicode, exact stored strings, and read-only register data.
- Reject blank content and duplicate-content conflicts without losing the draft. Show actual persistence state after every failure.
- Preview changes after any relevant draft edit. Ignore out-of-order preview responses without losing typed input.
- Introduce an intervening fact/entity update. A proposed conflict-aware Save must reject stale state without overwriting it.
- Inject failures after row commit, during links/vector/bank work, before/after journal append, and during undo marking.
- Test timeout followed by late commit, network loss, malformed acknowledgment, page reload, and deliberate retry recovery.
- Verify reverse-order undo and denied historical undo. Show partial results for any multi-fact action.
- Navigate, close, press Escape, and receive live refreshes with a dirty draft. No silent save or discard.
- Verify keyboard-only use, focus return, labelled controls, narrow windows, all supported themes, and reduced motion.
- Compare provider retrieval results before/after UI-only changes on synthetic fixtures. Query controls must preserve the same handler calls and math.

Use disposable synthetic stores and isolated browser fixtures for those tests. Do not reuse live memory or run scripts without first checking their data paths.

## Decision

Choose a single staged editor rather than more per-field prompts. Use only existing writable properties.
Keep query tuning separate from saved memory and persistent provider configuration.
The non-obvious constraint is that one journal event is not an atomic transaction. Design and copy must not imply otherwise.
Backend conflict checks and absolute combined trust are proposals that need explicit approval before implementation.
