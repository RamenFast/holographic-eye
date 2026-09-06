# Label clarity and memory editing

Status: frontend and shell1.3 are installed and verified. Provider/API1.1 remains unchanged. Release publication is in progress.

## User outcomes
1. Text visibly belongs to its node, preferably below it. No detached captions at the fully zoomed-out overview.
2. A discoverable color key explains the actual node colors and other important visual encodings.
3. Zoom reveals useful partial information. Content starts, tags and entities are valid previews; full content is not required.
4. A unified, readable editor makes memory contents and supported parameters easy to modify deliberately.

## Boundaries
- No automatic live memory edits. Mutation tests use synthetic fixtures only.
- Preserve retrieval math, coordinates, Zig/fallback picking, journal/undo safeguards, ten themes, accessibility and dirty rendering.
- Do not invent reasoning or fetch/generate it automatically. Show only stored or explicitly available context.
- Audit existing writable API fields before choosing editor controls. Keep unsupported/derived fields read-only and explain them.
- Do not change the provider/API or restart it during this audit. Propose any necessary backend change separately.
- Use private GUI displays. Do not touch JCode or other sessions.
- Use Astra for GPT workers in this Prime tree. Routine release decisions use Prime’s judgment under Ben’s authorization.

## Acceptance direction
- Synthetic zoom sweeps: overview has no ambiguous automatic captions; each visible caption has a measurable owner/anchor and no conflicting point or caption overlap.
- The key matches renderer color values across themes and explains non-color selection/attention marks.
- Previews remain bounded and preserve hit results, idle behavior and camera state.
- Editor tests cover clear field names, change preview, Save/cancel, stale data, rejected/unknown acknowledgments, duplicate prevention, partial-failure limits and recovery.
- No tests or previews write live memory. Do not claim atomic multi-action saving unless the existing API supports it.

Read LABEL-AUDIT.md and EDITOR-AUDIT.md when the workers finish, then freeze a concrete interface contract before implementation.

## Follow-up requirements
- The trust/superposition crowding explanation must remain available while the pointer is on the warning or its popout. Provide explicit dismissal and a Copy prompt action for Hermes. Copying must not send a message, launch an agent, or mutate memory. Label recommendations as guidance, not measured facts.
- Remove the redundant native GTK title bar for Ben’s tiling setup. Preserve WM close/resize behavior, minimum sizing and keyboard access. Test the actual native window on a private display; do not change WM configuration or other windows.
