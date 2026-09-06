# Holographic Eye handoff · 1.3.0

## Installed state
- Frontend and native DEB shell: **1.3.0**, installed and independently verified.
- Provider/API: **1.1.0**, unchanged. Gateway PID4025645 was preserved; no restart.
- No live database mutations, replacement, migration, or token changes were performed by installation/testing. Mutation tests used fresh temporary stores.
- Release reference: [v1.3.0](https://github.com/RamenFast/holographic-eye/releases/tag/v1.3.0). See GitHub for publication state.

## Delivered
Labels stay centered below nodes with stems. The overview omits ordinary captions, while zoom reveals bounded content/entity/tag previews. Color key explains actual renderer colors, trust, rings and size.

Inspect → Edit memory stages content/category/tags with preview and one details action. Absolute trust has a separate explicit Set trust action. Derived data stays read-only. Unknown outcomes block automatic retry, and reload/WM-close guards protect dirty, kept, busy and uncertain drafts.

The SNR button opens a persistent explanation and copyable Hermes prompt. It distinguishes a count-based estimate from Fact trust and measured recall accuracy. Copying does not send anything or mutate memory.

Native decorations are disabled for the tiling workflow. Minimum size and WM resize/close behavior were tested. No WM configuration or other windows were changed.

## Verification and limits
1,788 full UI checks,344 high-DPI/forced-colors checks,54 exact-DEB native checks,107 legacy GUI,194 transport,27 offline backend,7 Zig and16 Rust tests passed, plus component/model and browser differential/fallback checks. Native tests used private namespaces and Xvfb/Openbox.

The installed executable matches the DEB payload. All nine served assets match candidate3. Independent verification matched all12 protected non-frontend provider files and the unchanged gateway PID.

Drafts are not saved to disk. Preflight is not a server lock, and details/trust are not an atomic combined save. Memory and journal still have separate commit/crash boundaries. Persistent engine configuration is not editable here.

Performance exact pixels/hits passed, but draw medians increased5.3→5.8ms in the component benchmark. Warm labels were fast; first-use text layout reached22.7ms in one fixture. Do not claim a speedup, universal8ms cold bound, or native frame-rate result. See [validation](docs/dev/label-editor-pass/VALIDATION.md).

## Recovery
Previous frontend: `~/.hermes/.eye-frontend-stage-1.3-01a072ae`.
Private recovery/receipts: `/media/ben/Mass storage/agenticTinkering/claude/holographic-eye/2026-09-06-label-editor/`.
Rollback only shell/frontend if needed. Never replace live databases or deploy the unrelated old1.0.3 provider stage.

## Continuing authority
Ben entrusted routine releases to Prime unless he states otherwise. Verification and reversibility remain required; repeated routine publication approval prompts are not.
