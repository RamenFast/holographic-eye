# Implementation boundaries · label/editor pass

## Ownership
- Label worker: field.ts, field-labels.ts, label tests only.
- Editor worker: new memory-editor modules/styles/tests and Inspect integration in panes.ts only.
- Dialog/key worker: modals.ts, field color-key implementation/styles/tests only.
- Warning worker: new capacity-warning module/styles/tests only.
- Root: main.ts, index.html, shared style/build wiring, native shell decorations, integration and release.
No provider/API changes, live mutations, shared dist rebuilds, or heavy concurrent benchmarks.

## Labels
Fit-relative tiers: below1.25 no ordinary labels; below2.5 up to12 one-line previews; below4 up to24 two-line previews; above that up to48. At overview, at most hover and one intentionally selected fact can be labelled. Text Off means no canvas labels.
Labels center below their owner with a short vertical stem. Omit collisions; do not move captions beside unrelated dots. Preserve exact coordinates/picking. Use only loaded content/entities/tags or actual current Reason-result membership. Context-dimmed ordinary nodes do not gain prominent captions.
Keep 256 measured-candidate cap, safe Unicode truncation before expensive normalization, and honest timing reports. An8ms target is not a claimed universal cold bound.

## Unified memory editor
One visible Edit memory entry replaces keyboard-only content editing and native metadata prompts. Content/category/tags use one combined existing fact.update. Absolute Fact trust has a separately labelled staged Set trust action using fact.trust_set; never write on slider change. Do not pretend these two actions are one atomic Save.
Keep all controls in one coherent dialog. Preview details in place. Preserve drafts on refresh and use explicit discard handling. Prefetch fact.get, compare relevant current fields before writes, omit unchanged fields, and report conflicts without silent overwrite. State that this frontend check is not a server lock.
Unknown outcomes block further editor writes and preserve the draft. Show the known saved state and journal receipt; no automatic retries or rollback. Read-only technical fields stay read-only. Do not add persistent retrieval-configuration setters or raw vector editing.

## Dialog and color key
Use one canonical renderer-backed color key, reachable from a visible Color key button and the manual. Label actual category colors, trust brightness/opacity, recall-count radius and token-colored rings. Bound category rows. Preserve Reason/selection when closing the key or editor.
Extend shared modal lifecycle with a cancellable close guard and explicit context-preservation option. A refused close must not allow a second modal or execute new-modal handlers against the old element. Adapt existing callers safely; preserve keyboard focus and existing tests.

## Capacity explanation
A dedicated non-modal popout replaces the native title-only warning. Hover can open it; pointer travel onto it must not close it. Explicit close, click-away and Escape work without changing selection or Reason state. Freeze a validated metrics snapshot for copying. Copy prompt never sends an agent request. Clipboard failure gives selectable text, not a false success message.
Explain that SNR is a count-based estimate distinct from Fact trust, not measured recall loss. Use cautious guidance and no automatic destructive recommendations.

## Native frame
Remove redundant native GTK decorations for Ben’s tiling setup. Preserve WM close/resize and native minimum sizing. Verify on private Xvfb/Openbox, without modifying desktop/WM configuration.

## Copy-prompt authority clarification
Copying the capacity prompt performs no tool call or agent send. When Ben chooses to paste it into Hermes, the prompt requests bounded read-only diagnosis with Hermes tools. No second authorization prompt is required merely to inspect current state. It does not authorize destructive memory edits, configuration changes, vector rebuilds, or contacting other sessions. The audit’s earlier no-tool proposal was not adopted.
