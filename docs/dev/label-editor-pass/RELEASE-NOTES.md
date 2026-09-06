# Holographic Eye 1.3.0

A local cockpit for Hermes memory, with clearer labels and a friendlier editor.

| Area | 1.2 | 1.3 |
|---|---|---|
| Labels | Could sit beside or above unrelated nodes | Below-node captions with stems and quiet overview |
| Preview content | Content snippets | Progressive content, entity and tag previews |
| Colors | Key buried in the manual | Visible renderer-backed Color key |
| Editing | Scattered prompts and immediate trust slider | Unified staged editor with explicit saves |
| Capacity warning | Native tooltip | Persistent explanation and Copy prompt |
| Native frame | GTK/system decoration | Undecorated window with draft-safe WM close |
| Provider/API | 1.1.0 | Unchanged 1.1.0 |

![Verified synthetic interface](https://raw.githubusercontent.com/RamenFast/holographic-eye/v1.3.0/docs/hero-blossom-dark.png)

## Highlights
- Find **Color key** beside Text in the Field.
- Use **Inspect → Edit memory** for content, category, tags and separately staged Fact trust.
- Open **SNR** for the persistent capacity explanation. Copy prompt copies text for Hermes; it does not send or modify anything.
- Reload and native-close guards keep dirty, kept, busy and uncertain drafts from disappearing without a decision.

The exact DEB passed54 native WebKit/Openbox checks in a private synthetic network/display. Full UI1788, high-DPI/high-contrast344, legacy GUI107 and transport194 checks passed. Existing backend and Zig contracts also passed. Installed binary/assets and unchanged provider files were independently verified.

## Removed, honestly
The immediate trust-slider write and native metadata prompts are replaced by staged controls. Ordinary labels are intentionally omitted at the overview and in crowded areas; full content is not forced onto every node. Native title-bar buttons are removed; use your window manager’s close/move/resize actions.

No retrieval or mutation feature was silently removed. Persistent engine settings, raw vectors and derived fields remain read-only here. Quarantine/UMAP and live restore remain unbuilt. Drafts are page-local, not crash-persistent. Preflight is not a server lock; detail and absolute-trust actions are separate, not an atomic Save-all.

Exact pixel/hit checks passed, but synchronous draw medians increased5.3→5.8ms in the longer component comparison. Warm label layouts were fast; one first-use layout reached22.7ms. No speedup or universal8ms cold bound is claimed. Detailed receipts are included in docs/dev/label-editor-pass.

## Install
| System | Command |
|---|---|
| Debian / Ubuntu / Mint | `sudo apt install ./holographic-eye_1.3.0_amd64.deb` |
| Fedora / RHEL | `sudo dnf install ./holographic-eye-1.3.0-1.x86_64.rpm` |
| Source | Extract `holographic-eye-1.3.0-source.tar.gz`; follow README’s pinned Zig and native build instructions |

Packages install the shell, desktop entry, icons and man page. Existing installations also need the frontend-only update described in README. Provider/API remains1.1.0; no gateway restart is needed. Native builds require WebKitGTK4.1 version2.40 or newer. Linux Mint is tested; RPM payload validation is not a Fedora runtime claim.

Verify:
```bash
holographic-eye version --json
holographic-eye status --json
```
Expected shell version: `1.3.0`. Launch a fresh Eye window for the new code.

## Checksums
Download all desired assets and `SHA256SUMS`, then run `sha256sum -c SHA256SUMS`. Keep the prior frontend backup until verification succeeds.

GPLv3. System-resolved fonts. Original implementation: Claude (Fable5). Refinement: Prime and GPT workers, built with Ben.
