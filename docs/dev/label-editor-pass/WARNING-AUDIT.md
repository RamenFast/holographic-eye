# Warning audit: crowding explanation and Hermes prompt

Status: source-only audit and proposed interface contract. No application changes or runtime verification.
Scope: Prime's `docs/dev/label-editor-pass/` work. No live reads, database access, agent calls, service changes, or edits outside this report.

## Context and outcome

Ben needs time to read the crowding explanation and copy a request for Hermes.
The explanation must not disappear as the pointer moves from its trigger to its content.
It must also work without a mouse. Copying must only copy text.

Target: the existing TypeScript frontend and native Linux WebKit shell.
Keep the provider, retrieval math, data, ten themes, picking, and camera unchanged.
Use sharp corners, existing theme tokens, visible focus, and plain text alongside warning color.

Deliverables for a later implementation:
1. A persistent, non-modal explanation beside the SNR metric.
2. Explicit Close, click-away, and Escape dismissal.
3. A visible, selectable Hermes prompt and Copy prompt action.
4. Synthetic behavioral tests and a private native clipboard check.

## Observed source hooks

Paths below are relative to the repository root. Line numbers describe the audited source and can shift.

| Hook | Observed behavior |
|---|---|
| `build/eye_frontend/src/main.ts:70-100`, `renderStatusBar()` | Reads `store.stats`. Builds the trust histogram and SNR warning with `innerHTML`. Replaces the entire `#sb-metrics` subtree. |
| `main.ts:80-81` | Warning trigger is `(s.snr ?? 9) < 2.0`. It is an unfocusable `span.warn` with a native `title`, not an app popout. |
| `main.ts:94-96` | The adjacent trust sparkline opens `openTrustLens`. This is a separate feature, not the crowding warning. |
| `main.ts:153-215`, `openTrustLens()` | Existing persistent trust filter with outside-mousedown dismissal. It changes only the field lens. Do not replace its behavior with the new explanation. |
| `main.ts:62-68`, `refreshStats()` | Loads stats into `store.stats`, then redraws the status bar. |
| `main.ts:622-642` | WebSocket hello also replaces stats. Connection status redraws the bar. A 15-second poll keeps the last good reading if its read fails. |
| `build/eye_frontend/src/state.ts:52` | `stats` is typed `any` and initially empty. Validate copied metrics instead of trusting coercion. |
| `build/eye_provider/control.py:209-262`, `stats()` | Defines the provider snapshot and its metric calculations. Read as source only. |
| `control.py:224-234` | `facts` counts all rows. `null_vectors` counts rows without vectors. Histogram groups `ROUND(trust_score, 1)`. |
| `control.py:235-249` | Exposes category counts, banks (`bank_name`, `dim`, `fact_count`, `updated_at`), `hrr_dim`, `snr`, and `min_trust`. |
| `control.py:246-248` | SNR is `round(sqrt(dim / max(1, facts)), 3)`. Dimension uses `store.hrr_dim`, with a provider fallback of 1024. |
| `build/eye_frontend/src/modals.ts:623`, glossary SNR row | Repeats the claim that recall accuracy degrades. Update this text with the explanation to prevent conflicting guidance. |
| `modals.ts:475-552`, `openAskAgent()` | Not a safe reuse target. Opening it immediately calls `agent.sessions`, starts an eight-second refresh, and exposes Send to agent. Its default prompt authorizes update/remove. |
| `modals.ts:534-547` | Clipboard handler has useful success/failure patterns, including manual-copy guidance. Extract the pattern only, not the agent modal. |
| `modals.ts:41-106`, `modal()` | Existing modal has focus and close patterns, but is modal and its close clears `reasonHalo`. Do not reuse it unchanged for a hover explanation. |
| `main.ts:524-574`, `altHistoryBlocked()` / `bindKeys()` | Integrate the new popout with keyboard ownership. Escape must close only the top explanation, not clear selection or highlights. |
| `build/eye_frontend/styles.css:196,467,575,642-689` | Warning token, modal/lens surface patterns, and narrow-window rules. Add scoped styles, not broad tooltip overrides. |

Current warning title, verbatim:

> signal-to-noise √(dim/facts) below 2.0 — the holographic superposition is crowded; recall accuracy degrades as more facts are added

### What these sources do and do not establish

The title disappearing is consistent with a browser-managed tooltip. Static source does not prove the exact native hover timing.
There is no app-owned hover lifetime, Copy action, or focus target for this warning.

SNR is a count-based estimate, not measured retrieval accuracy or a corruption test.
Its denominator includes facts without vectors. It is not a per-bank calculation.
The provider also supplies bank counts, but the warning does not use them.
Do not silently substitute vector count or a selected bank for the existing global formula.

Trust is a stored weight. The sparkline bins are rounded counts, not evidence of truth or falsehood.
A trust-lens filter does not reduce stored fact count or change SNR.
The warning does not establish that duplicates, wrong trust values, or broken memories caused a problem.
The available snapshot has no measurement of lost recall accuracy.

No numeric readings from Ben's running memory were inspected. All example values below are synthetic.

## Focused design decision

Use a dedicated non-modal popout with a small local controller.
Do not route through Ask the agent, and do not add a backend endpoint.
An extra hover timeout alone is a trap: it still loses the explanation during reading and provides no keyboard or copy path.

1. Keep a labeled SNR details button available even when the warning is absent.
2. For a finite numeric SNR below 2.0, include the warning glyph and text `Crowding estimate`.
3. Pointer entry on the details button opens the explanation without moving keyboard focus.
4. Click, Enter, or Space opens it and moves focus to its heading or first control.
5. Once open, pointer exit never closes it. No hide timer runs while reading or selecting text.
6. Close only with Close, an intentional click outside, or Escape.
7. After Close or Escape, do not immediately reopen from the pointer still covering the trigger. Require exit and re-entry.
8. Keep the popout outside `#sb-metrics`. Status redraws must not remove it, replace its text, or lose its focus.
9. Prefer a stable trigger node with metric text updates. If rebuilt, restore focus by its stable ID, not a detached node.
10. Position from the trigger rectangle and clamp to the viewport. Reposition on resize and status-layout changes.
11. Constrain height and scroll the body. Keep Close and Copy prompt reachable at narrow widths and large text sizes.
12. Keep one explanation instance and remove its listeners on every close path.

Use `role="dialog"`, `aria-modal="false"`, an accessible heading, and a real button with `aria-expanded` and `aria-controls`.
Do not use `role="tooltip"` for interactive controls.
Do not trap Tab in a non-modal surface. All controls must remain keyboard reachable.
Return keyboard focus to the current trigger after Close or Escape when focus was inside.
For click-away, preserve focus on the clicked destination.
Avoid focus theft on passive hover or live metric changes.
Guard field shortcuts while focus is inside the explanation. Closing must preserve camera, selection, lens, and reason halo.

### Proposed explanation copy

Title: **Crowding estimate**

> This estimate compares HRR dimensions with the total stored fact count.
> A lower value can suggest more interference in a bundled representation.
> It does not measure recall accuracy or show that memories are damaged.

Observed metrics:
- Reported SNR: `{snr}`.
- HRR dimensions: `{hrr_dim}`.
- Stored facts: `{facts}`, including `{null_vectors}` without vectors when that count is available.
- Formula: `sqrt(hrr_dim / max(1, facts))`, rounded to three decimals by the provider.
- UI warning condition: reported SNR below `2.0`.
- Minimum trust: `{min_trust}`, only when available. State that trust and crowding are different measures.

**Guidance, not a finding:**

> Review representative recall examples before changing memory.
> Check possible duplicates or stale facts only if the evidence supports that work.
> Do not delete useful memories or raise trust just to remove this warning.

Show `Copy prompt` and `Close` as text buttons.
Below the copy action: `Copies text only. Nothing is sent to Hermes.`

### Snapshot and uncertainty contract

Freeze a validated, shallow metrics snapshot when the explanation opens.
The visible metrics and copied prompt must refer to that same snapshot.
If later stats arrive, do not replace text under selection. Show `Newer data is available. Reopen to update.`
Keep the explanation open even if the live SNR crosses the warning boundary.

A locally recorded receipt time can be labeled `Received by Eye at`, not `Measured at`.
Do not invent a provider timestamp or use journal event age as stats freshness.
Existing failed polls keep cached stats. Without explicit freshness tracking, say `Last loaded snapshot; freshness not verified`.
Optional connection status is separate from snapshot freshness.
Do not infer active agent work from connection status, session ID, or journal quiet time.

Accept finite numbers only. Counts and dimensions must also be valid integers with appropriate nonnegative/positive bounds.
Missing, malformed, negative SNR, or non-finite values mean `Unavailable`, not zero or healthy.
Do not use the default `9` as a displayed or copied observation.
Do not invent 1024 dimensions or 0.3 minimum trust on the frontend when their fields are absent.
No extra read occurs on open, refresh indication, copy, or dismissal.
The application's existing background reads remain unchanged.

## Copyable prompt contract

Generate plain text from the same validated snapshot, not DOM HTML.
Use only required aggregate numbers. Omit fact content, entities, tags, paths, tokens, and session identifiers.
Keep a labeled, read-only textarea visible so manual selection works when clipboard permission is denied or unavailable.
Only show `Copied. Paste it into Hermes.` after `navigator.clipboard.writeText` resolves.
On failure, say `Copy failed. Select the prompt below and copy it manually.` Keep the popout open.
Ignore completion UI updates after dismissal. Prevent duplicate in-flight copy operations and restore the button after failure.

Worked example, synthetic input:
`snr=1.6`, `hrr_dim=1024`, `facts=400`, `null_vectors=12`, `min_trust=0.3`.
Expected copied text:

```text
Holographic Eye generated this review request for Ben to paste into Hermes.
Please help me understand the Eye's crowding estimate before we change memory.

Observed in the last loaded Eye snapshot:
- Reported SNR estimate: 1.6.
- HRR dimensions: 1024.
- Total stored facts: 400.
- Facts without vectors: 12. These are included in the total.
- Minimum trust reported by the provider: 0.3.
- Snapshot freshness is not verified.

The provider uses sqrt(dimensions / max(1, total facts)), rounded to three decimals.
The Eye warns when the reported estimate is below 2.0.
This is not measured recall accuracy, a duplicate finding, or evidence of damaged memory.
Trust is a separate weight. Changing the visual trust filter does not change this estimate.

Start with these supplied observations. Do not read live memory or call tools from this prompt alone.
Separate observations, possible causes, and guidance.
Suggest a small read-only recall check that we could authorize next.
Do not change trust, delete or merge facts, rebuild vectors, or change provider settings.
Do not contact another agent or disturb another session.

Done means a short explanation, the evidence still needed, and one proposed next check.
If the evidence is insufficient, use:
Blocked: the exact missing evidence.
Evidence: what this snapshot does establish.
Best current result: the useful partial explanation.
Next step: the smallest proposed check.
```

For absent metrics, print `Unavailable` rather than guessing.
Do not embed this synthetic example's numbers in production copy.
The prompt is deliberately a review request, not automatic cleanup authority.
Ben can decide separately whether to authorize further investigation.

## Acceptance tests for implementation

Tests below are proposed, not executed by this audit.
Use synthetic fixtures only. Deny or intercept network calls outside the private fixture server.

| Test | Required result |
|---|---|
| Threshold | Synthetic SNR 1.999 warns. 2.0 and 2.001 do not. Zero is handled as a supplied numeric value. Invalid values show unavailable. |
| Rounded boundary | Provider may round an underlying value to 2.000. Use reported SNR, not a newly computed frontend comparison. |
| Hover continuity | Move onto trigger, across any gap, and onto text or Copy. Wait beyond browser tooltip timing. Explanation remains. |
| Persistence | Leaving both trigger and panel does not close it. Close, click-away, and Escape do. No immediate reopen after explicit dismissal. |
| Focus | Enter/Space opens from trigger. All actions and textarea are reachable. Visible focus persists. No passive-hover focus theft. |
| Escape ownership | One Escape closes explanation only. Selection, highlights, lens, reason halo, and camera remain unchanged. |
| Status churn | Re-render stats and connection state while hovering, focusing, and selecting text. Popout stays open and snapshot stays stable. |
| Warning clears | Change live SNR from 1.6 to 2.2. Open explanation stays readable and copied values remain its original snapshot. |
| Clipboard success | Copy output exactly matches the visible snapshot and reviewed template. No success message before promise resolution. |
| Clipboard failure | Missing clipboard API, denied permission, and rejected write show manual-copy guidance. Text remains selectable and retry works. |
| Dismiss during copy | Resolve/reject after Close. No detached-DOM error, focus theft, or reopened popout. |
| No side effects | Compare request logs before/after open, copy, and dismissal. No new requests, `agent.sessions`, `agent.ask`, refresh, or mutation RPC. |
| Missing data | Missing dimensions, facts, null count, trust, and SNR never become fabricated defaults. Numeric strings, NaN, and infinity are unavailable. |
| Injection boundary | Unexpected strings in stats are not interpreted as HTML or instructions. Prompt contains only allowlisted aggregate metrics. |
| Layout/themes | Test narrow supported native size, wide desktop, all four UI scales, all ten themes, forced colors, and reduced motion. No clipped actions. |
| Lifetime/idle | Repeat open/close 100 times. One instance, no accumulating listeners, no new polling loop, no continuous canvas redraw. |
| Regression | Trust lens still changes field visibility only. Existing picking, camera, dirty rendering, and modal paths retain behavior. |
| Native proof | On a private synthetic WebKit display, hover/select/copy succeeds through the app path. Denied clipboard still supports manual copying. |

Relevant existing verification surfaces: `build/verify/test_responsive_views.cjs`, `test_native_candidate.cjs`, `test_transport.cjs`, and `gui_edge.cjs`.
Add focused warning tests rather than broad changes to provider tests.
Run frontend `npm run check` from `build/eye_frontend` using its installed project environment during implementation.

## Audit result and remaining uncertainty

Source establishes a native-title-only warning and an unsafe reuse path through Ask the agent.
The focused fix needs frontend state, copy, styles, and synthetic tests only.
No provider changes are required for the reported aggregate metrics.
The audit did not run Eye, inspect live data, reproduce native timing, or test clipboard behavior.
Those runtime checks remain required before declaring the fix complete.

## Implementation amendment from root
The initial no-tool proposal above is superseded by INTERFACES.md: the Copy action has no I/O beyond clipboard, but the generated request permits bounded read-only tool diagnosis when Ben pastes it into Hermes. Automatic destructive/config/vector edits and cross-session actions remain excluded.
