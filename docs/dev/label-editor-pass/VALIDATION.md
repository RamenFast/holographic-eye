# Holographic Eye 1.3 validation

Frontend and shell 1.3.0 are installed. Provider/API 1.1.0 is unchanged.

## User outcomes and evidence
| Outcome | Evidence |
|---|---|
| Below-node partial previews, quiet overview | Tier/anchor/stem/collision tests, exact picking checks, screenshots |
| Discoverable color key | Actual renderer color comparisons across ten themes |
| Friendly staged editor | Combined detail and separate absolute-trust RPCs through fresh temporary stores; no slider-change writes |
| Draft protection | Dirty/kept/busy/unknown reload, navigation and native WM close checks |
| Persistent capacity explanation and Copy prompt | Hover/focus/overlay/copy-failure tests; no automatic API or agent calls |
| No redundant GTK title bar | Exact-DEB native zero-frame-extents, minimum-size and WM-resize proof |

## Passed
- 1,788 full UI checks: ten themes, four text scales, widths640/800/1100/1440 at480px height, behavior and temporary-store RPC cases.
- 344 DPR2/forced-colors smoke checks.
- 54 native WebKit/Openbox checks using the exact DEB, private user/network namespaces, HOME/XDG/DBus and Xvfb. One deliberate synthetic trust request; close operations caused no extra writes.
- 107 legacy GUI and194 transport checks.
- 27 offline backend tests; seven Zig tests and browser differential/fallback coverage.
- 16 Rust tests, Clippy and formatting.
- Component/model checks for labels, editor, capacity and shared dialog/key behavior.

Source review found and closed draft-loss, overlay-key ownership, invalid SNR display and stale evidence issues. Early harness failures are retained and explained in the local receipts; they were not counted as application passes.

## Performance, honestly
The long v1.2/current component comparison preserved exact canvas pixels and hits. Median synchronous draw time was5.3ms baseline versus5.8ms candidate; per-run p95 medians were6.9 versus7.8ms. This is not a speedup or native frame-presentation claim.

Label timings used1920×1200 and recorded actual visible/accepted/measured counts. At1,500 facts and z2.5, cold layout was22.7ms and warmed p951.5ms. At20k/z8,48 labels were accepted from55 measured candidates: cold7.9ms, warmed p951.4ms. Overview and dense scenes can omit captions. The8ms target is not a universal cold bound. See CANDIDATE3-PERFORMANCE.md and its raw receipts.

## Installation
Installed binary equals the exact tested DEB payload. Nine served frontend files equal candidate3. Twelve non-frontend provider files equal the protected baseline, and gateway PID4025645 stayed active. No service restart, database migration/replacement, or live test mutation occurred.

Rollback frontend: `~/.hermes/.eye-frontend-stage-1.3-01a072ae`.
Private recovery and logs: `/media/ben/Mass storage/agenticTinkering/claude/holographic-eye/2026-09-06-label-editor/`.

## Local full receipts
- `build/verify/shots/label-editor/candidate3-full/`
- `build/verify/shots/label-editor/candidate3-accessibility/`
- `build/verify/shots/native-close/candidate3-pass3/`
- `build/verify/shots/gui-edge/v13-final/`

The source repository includes the reproducible harnesses and performance receipts. Screenshots use synthetic memories only. RPM availability is not a claim of Fedora runtime installation.
