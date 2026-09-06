# Holographic Eye handoff · 1.2.0

## Installed state
- Native DEB shell and served frontend: **1.2.0**, installed and verified.
- Memory provider/API: **1.1.0**, unchanged. Gateway PID 4025645 was preserved.
- No database writes, replacement, migration, token changes, or service restart were performed by this pass.
- Existing Eye windows were not closed or reloaded. Reopen Eye to load the new interface.
- Release reference: [v1.2.0](https://github.com/RamenFast/holographic-eye/releases/tag/v1.2.0). See the release page for publication state.

## New interface
Narrow windows use Explore/Evidence/Inspect modes. Dialog headers and close controls remain accessible while the body scrolls. The Field adds bounded content snippets without changing coordinates or picking. Categories and Timeline browse loaded facts with exact category filters and explicit Stored/Last updated UTC dates. Unknown dates remain visible.

## Verification
981 responsive checks, 107 legacy GUI checks, 194 transport checks, 27 offline backend checks, 15 Explorer model/controller checks, seven Zig tests, and 14 Rust tests passed. Clippy and formatting passed. Native WebKit/Openbox checks passed 9/9 for both the release binary and exact DEB payload using isolated synthetic fixtures.

The installed executable matches the tested DEB. All served frontend hashes match candidate 5. Provider files outside the frontend match the protected baseline.

The longer component benchmark preserved exact pixels and hits. Warmed median draw time was 4.7ms baseline versus 4.6ms candidate; p95 was 5.7 versus 6.1ms. This is synchronous canvas-command timing with labels off, not native frame presentation. Label layout at 20,000 facts can exceed the 8ms target, especially cold. See [validation](docs/dev/next-ui-pass/VALIDATION.md) for both favorable and unfavorable observations.

## Recovery
The old frontend remains at `~/.hermes/.eye-frontend-stage-1.2-01a072ae` after the atomic exchange. Private recovery copies and installation receipts are in `/media/ben/Mass storage/agenticTinkering/claude/holographic-eye/2026-09-05-responsive-exploration/`.

Rollback only the shell/frontend if needed. Do not replace live databases or deploy the old 1.0.3 provider staging tree. The unchanged provider does not need a restart.

## Release authority
Ben approved publication and entrusted routine release decisions to Prime unless he states otherwise. Recovery and verification remain required; repeated publication approval prompts are not.

The completed v1.1.0 history remains available in the v1.1.0 tag. Its provider restart and database checks are historical, not actions performed in this pass.
