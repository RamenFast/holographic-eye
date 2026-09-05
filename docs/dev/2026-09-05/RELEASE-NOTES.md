# Holographic Eye 1.1.0

A local memory cockpit with a Field-first interface and a Zig/WebAssembly selection engine.

| Surface | 1.0.3 | 1.1.0 |
|---|---|---|
| Inspect | Fixed empty pane | Compact empty rail, fact history, clearer evidence bands |
| Journal | Rebuilt rows on each event | Batched, keyed rows and a compact latest-event glance |
| Field hit testing | Repeated layout reads | One viewport read and a 319-byte Zig/WASM kernel |
| Disconnection | Could miss intervening changes | Projection, entities, stats, and recent journal catch up |
| Undo | Could overwrite a newer edit | State and later-resource checks reject stale or ABA undo |
| Invalid mutation input | Coercions could reach the store | Typed, finite validation before store calls |
| Failed acknowledgment | Could look successful | Unknown outcomes stay explicit and are not retried |
| Native shell | Version switch only | Structured help, schema, status, errors, and recovery screen |

## Highlights

- Ten themes and four text scales remain. The Field keeps its actual HRR/PCA geometry.
- Inspect keeps up to 50 single- and multi-selection snapshots.
- Zig handles pointer hit testing with strict float64 behavior. A JavaScript fallback stays available.
- The journal treats stored content as text, not executable HTML.
- Missing tokens and denied browser storage no longer trap the interface in a retry loop.
- Modals manage focus, remove listeners, reject stale responses, and guard duplicate submissions.
- The unchanged NumPy SVD uses a scoped two-thread BLAS cap when threadpoolctl is available.

Synthetic benchmarks on the development host show about 17× faster live journal bursts in the final run.
The optimized JavaScript versus Zig benchmark shows about 3× faster hit testing at 3,000 facts.
The combined old-layout-loop versus current kernel gain is larger; it must not be attributed to Zig alone.
All compared Field pixels and hit IDs matched. These are not native WebKitGTK performance measurements.

## Removed, honestly

No core memory capability was removed. Unsafe stale undo and malformed mutation coercions are now rejected.
Quarantine, UMAP, and live database restore remain unbuilt.
Memory and journal are separate SQLite files. Cross-process and crash-atomic updates are not claimed.
Agent writes remain best-effort journaled if the journal fails; Eye controls report incomplete journaling explicitly.

## Install

| Platform | Command |
|---|---|
| Debian / Ubuntu / Mint | `sudo apt install ./holographic-eye_1.1.0_amd64.deb` |
| Fedora / RHEL | `sudo dnf install ./holographic-eye-1.1.0-1.x86_64.rpm` |
| Source | Follow the pinned Zig, frontend, and Tauri build steps in README.md |

The package installs the native shell, desktop entry, icons, man page, and GPL text.
The user-level provider and served interface still require the separate deployment step.
Provider upgrades must preserve active conversations. Frontend-only updates need no gateway restart.
RPM is payload/test-transaction verified on Mint, not runtime-tested on Fedora.

Verify: `holographic-eye version --json` reports `1.1.0`; `holographic-eye status --json` checks attachment.
The local installation and full activation status are recorded in HANDOFF.md.

## Verification and checksums

The release includes SHA256SUMS for DEB, RPM, and source assets.
The test matrix covers synthetic databases, browser edge cases, strict mutation acknowledgments,
Zig equivalence and fallback, native CLI behavior, and read-only installed-app checks.
Screenshots use synthetic data, not personal memories.

*Built with Ben. Original implementation: Claude (Fable 5). Refinement: Prime and GPT workers, including Astra.*
