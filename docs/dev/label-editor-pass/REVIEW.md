# Holographic Eye 1.3 independent source review

Date: 2026-09-06. Result: source findings corrected. Runtime release proof remains with root and QA.

The findings below preserve the initial review. Focused re-review sections record their closure.

## Scope and evidence

Read SPEC.md, INTERFACES.md, all three audits, and the candidate frontend sources.
Reviewed the editor model, editor dialog, Inspect integration, shared modal lifecycle, capacity explanation, main keyboard routing, Field labels, and color key.
Read editor and integrated acceptance tests. Read existing API acknowledgment handling and provider mutation/image functions to verify response shapes.

This is source reasoning, not a runtime pass. No tests, GUI, database, RPC, provider changes, or application edits were made.
Only this report was written. No additional model or harness was used.
The component authors and root still own synthetic and private-native proof.

## Actionable findings

### R1 · High: page and native close bypass draft protection

Paths: `build/eye_frontend/src/memory-editor.ts:8,24-38,67`, `main.ts:535-538`, `modals.ts:91-116`.

Drafts live only in the page-local `drafts` Map. The close guard protects shared modal closure, not page unload or native window closure.
The editor even says reload or app closure discards unsaved drafts. This warning does not obtain an explicit discard decision.

A dirty editor plus Ctrl+R is a concrete browser path to investigate. Main returns for an open modal before preventing the reload shortcut.
The modal handler only handles Escape and Tab. No authored page-unload or native-close protection was found.
A pending or unknown save can therefore lose both its draft and the local block on further writes when the page dies.
Kept drafts are also vulnerable after the editor closes.

Fix: protect page/native closure whenever any retained draft is dirty, busy, or unknown.
Block accidental reload shortcuts while editing. Route intentional closure through a draft-aware decision.
Do not rely on a browser beforeunload prompt alone for the native shell.
Do not silently persist private memory text into durable browser storage as a substitute.

Proof: synthetic Ctrl+R and navigation cases with dirty, kept, busy, and unknown drafts.
Verify native WM close separately on the authorized private display.
Browser/WebKit shortcut and WM behavior remain untested by this review.

### R2 · Medium: capacity Escape handler can close an older overlay first

Paths: `build/eye_frontend/src/capacity-warning.ts:110-124`, `main.ts:529-562`.

The capacity handler captures Escape at `window` and stops all later handlers whenever its panel exists.
It yields only to `.modal-back`, not to Find, the trust lens, or an entity menu.
The popout is non-modal, so these surfaces can open after it without dismissing it.

Example: hover to open capacity, move away, then use Ctrl+F outside the panel.
Find opens above the earlier popout. Escape closes capacity and leaves Find open.
Focus can stay in Find while the unrelated older explanation disappears.

Fix: define one top-overlay Escape owner. Alternatively close capacity when another transient surface opens.
Keep click-away focus behavior and the frozen snapshot unchanged.

Proof: open capacity before Find and before a context menu. Escape must dismiss only the newer surface.
Also test the reverse order and ensure Field selection and Reason state stay unchanged.

### R3 · Medium: status trigger bypasses validated SNR display

Paths: `build/eye_frontend/src/main.ts:83-84`, `capacity-warning.ts:10-21`.

The warning controller validates SNR, but the visible trigger renders raw `s.snr`.
A negative number or numeric string appears as a reported reading with no warning.
The opened explanation then reports Unavailable for the same value.
Missing data appears as an ellipsis rather than the specified unavailable state.

Fix: render the trigger from the same validated snapshot as its warning state and explanation.
Keep the reported-number threshold. Do not recompute SNR or invent a fallback.

Proof: negative, string, missing, NaN, Infinity, zero, 1.999, and 2.0 fixtures.
The trigger, warning state, and explanation must agree.

### R4 · Low: successful save drops two read-only evidence fields

Paths: `build/eye_frontend/src/memory-editor-model.ts:112-120,132-135`, `memory-editor.ts:169-173`.
Source contract: `build/eye_provider/mutations.py:fact_update,fact_trust_set`, `images.py:fact_image`.

Mutation success returns `fact_image`, containing `hrr_vector_b64` but not `vector_bytes` or `journal_retrievals`.
The editor replaces `current` with this response, then renders only the missing byte-count and journal-count properties.
JSON serialization removes those undefined entries. Vector presence and journal-observed count disappear after a successful save.
The global view refresh does not refresh this draft image.

Fix: distinguish response shapes. Show vector presence from the returned vector field.
Fetch `fact.get` for read-only counts without treating a failed follow-up read as an unknown mutation.
Keep the acknowledged event and saved state visible during that read.

Proof: use the real mutation response shape in the synthetic model/UI fixture, not a spread of the fact.get fixture.

## Existing risks, not new regressions

- `panes.ts:587,704-706` still labels a global `backfill_vectors` action as “backfill vector” inside one fact.
  Rename it “Backfill all missing vectors” and disclose scope before this action is presented as per-fact work.
- `panes.ts:651-655` still suppresses individual bulk-feedback failures.
  This is not a unified-editor failure, but it remains an unresolved partial-result surface.
- Frontend preflight compares detail scalars or trust only. It is not a server lock and does not detect every entity-link change or ABA edit.
  The editor correctly discloses the lock limitation. Backend conflict prevention remains separate, unauthorized work.
- The editor does not offer an inline Undo action. It offers journal receipt reads, with existing Undo remaining in Inspect/Queue.
  Do not describe this candidate as implementing the audit proposal's inline Undo control.

## Positive source findings

- Detail edits use one existing `fact.update` with only changed content/category/tags.
- Absolute trust uses a separate explicit `fact.trust_set`. Slider input does not call RPC.
- Model busy state rejects duplicate writes. Unknown acknowledgments block both editor write actions and retain the draft across modal closes.
- Preview stays inside the editor. Failed reads, stale scalar values, and malformed preview responses do not silently replace typed values.
- Shared modal replacement stops when the existing guard refuses. Reviewed callers check the nullable result before binding or starting their modal work.
- Editor and color-key closure preserve Reason state. Modal async handlers generally check their own lifetime and request generation.
- Capacity copy uses a validated frozen aggregate snapshot, has no transport dependency, waits for clipboard acknowledgment, and retains manual-copy text on failure.
- Labels center below their owner and use vertical stems. Layout rejects collisions rather than moving captions sideways.
- Fit-relative tiers, candidate/label/cache limits, context suppression, and Field invalidation are wired in source.
- Provider/API edits are not needed for the recommended frontend fixes.

## Remaining verification

Do not convert these source findings into native behavior, timing, or accessibility claims.
The reviewed integrated test covers many happy and failure paths, but not R1 or R2.
Keep release held until the root resolves the findings and completes the frozen-candidate checks.

## Focused re-review · R2 and R3

The corrected source closes R2 and R3. Runtime proof remains separate.

- `CapacityWarning.foregroundOverlay()` checks visible higher overlays. Both `keys()` and `open()` yield to them.
- `main.ts` now renders the SNR trigger from `capacitySnapshot(s).snr`, with Unavailable for invalid readings.
- Source-inspected component tests cover higher overlays, hidden overlays, and reverse opening order. They were not run by this reviewer.
- Requested the real Find-over-capacity ordering check from the integrated QA owner.

R1 and R4 await their owners' source-ready signals.

## Focused re-review · R1, R4, and backfill scope

R1 and R4 are corrected in source. No new source blocker was found in these corrections.

- Retained risky drafts install a page-unload guard and capture Ctrl/Meta+R and F5. Kept drafts remain covered.
- `requestMemoryEditorExit()` provides one shared pending decision and explicit keep/exit actions. It warns that unresolved saves can still complete after exit.
- `main.ts` exposes `eyeRequestClose` before boot. Native `main.rs` prevents WM closure, awaits the decision, and coalesces duplicate requests.
- Native evaluation errors refuse closure. An approved decision destroys the window without disabling the separate reload guard.
- Mutation responses now retain prior technical measurements until a follow-up `fact.get` refreshes them. Failed evidence reads mark measurements stale without losing the journal receipt or inventing an unknown mutation.
- The Inspect action now reads “Backfill all missing vectors”. Its title explicitly states that it affects every fact with a missing vector.

Read the added model tests for mutation-image evidence, failed follow-up reads, and exit risk. Did not execute them.
Private-native close behavior and integrated page-lifecycle tests remain required before release.

### Confirmed copy-prompt direction

Root confirmed the newer authority contract and recorded it in INTERFACES.md and WARNING-AUDIT.md.
Copy still makes no transport or agent call. Ben pasting the request authorizes bounded read-only Hermes diagnosis without another permission gate.
The template does not authorize automatic destructive edits, configuration changes, vector rebuilds, or cross-session contact.
This is an explicit supersession of the audit's earlier no-tool proposal, not unexplained implementation drift.
