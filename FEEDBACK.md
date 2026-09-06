# FEEDBACK.md — HolographicViewer session feedback ledger

<!-- DO NOT DELETE. Ben's permission is required to delete this file. -->
<!-- Scope: THIS repo only (glass cockpit for the Hermes holographic memory provider). Other projects carry their own
     FEEDBACK.md. -->

Every atomic claim, ask, correction, bugfix, feature request, and UI change Ben
gives in a session gets one line here, appended by the working agent as SOP.

Rules:
- One line per atomic item: `- YYYY-MM-DD [kind] description` where kind is one
  of `ask` · `correction` · `bugfix` · `feature` · `ui` · `claim`.
- On a duplicate/repeat: do NOT add a new line. Keep the existing line, tighten
  its wording if needed, and prefix a counter: `- 2x YYYY-MM-DD ...` (bump the
  counter, update the date to the latest occurrence). Repeats matter — they
  show what keeps breaking.
- Newest entries at the bottom of the ledger.
- No autonomous action is to be taken from this document. Ben mines it and
  updates AGENTS.md himself.

## Ledger


- 2026-09-05 [claim] Core Holographic Eye functionality works well and must remain intact.
- 2026-09-05 [ask] Test edge cases and repair verified defects.
- 2026-09-05 [ui] Elaborate the interface and improve navigation, clarity, and usability.
- 2026-09-05 [ui] Make the interface sleeker and prettier.
- 2026-09-05 [ask] Protect the holographic memory database throughout testing and upgrades.
- 2026-09-05 [ask] Improve autonomously, update GitHub, and install and test the latest DEB package.
- 2026-09-05 [ask] Improve performance using measured bottlenecks and before/after checks.
- 2026-09-05 [ask] Rewrite code sections when this improves effectiveness while preserving memory behavior.
- 2026-09-05 [ask] Use a programming language with style, such as Zig, Elixir, Odin, or pure C, for a meaningful part of the improvement.

- 2026-09-05 [bugfix] Repair title bars on floating views; clarify whether internal dialogs, native window chrome, or both are affected.
- 2026-09-05 [bugfix] Make the interface render correctly in narrow windows, not only large desktop widths.
- 2026-09-05 [feature] Reveal fact text and content while zooming when the Field has enough free space.
- 2026-09-05 [feature] Add useful category-based memory views.
- 2026-09-05 [feature] Add useful timeline views with explicit date semantics.

- 2026-09-05 [correction] Fact captions must clearly belong to their nodes, preferably below them; fully zoomed-out text is currently ambiguous.
- 2026-09-05 [ui] Add a discoverable color chart explaining the node colors.
- 2026-09-05 [ui] Progressive zoom may show tags, entities, available reasoning context, or a content start; full content is not required.
- 2026-09-05 [feature] Build a unified, Ben-friendly surface for modifying memory contents and supported parameters.
- 2026-09-05 [ui] Keep the holographic trust/crowding warning open while the pointer is over it, and provide a copyable Hermes-agent prompt.
- 2026-09-05 [correction] Remove redundant GTK window headers for Ben’s tiling-window-manager setup.
