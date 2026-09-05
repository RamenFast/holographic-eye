# D-0016 · Field-first Evidence Bench UI

Status: approved candidate behavior on `dev`. This document narrows the UI work in `SPEC.md`.
It does not authorize deployment, a release, a live request, or a database mutation.

## Frame

- Keep the 32 px application header and the fixed 250 px left bench.
- Give all remaining width to the Field until Inspect has a selected fact or the user opens it.
- Show Inspect as a 42 px rail when it is empty and closed.
- Open Inspect to 304 px for any selection. Let the user open the empty pane from its rail.
- Keep the garden in its own 22 px lane. The garden must not cover controls or data.
- Show Stream as a 30 px dock by default. A real button expands it to 112 px and collapses it again.
- Persist only the user's Stream expanded preference. The default without a preference is collapsed.

## Header and left bench

- Use a semantic `header` and real buttons for ask, reason, backup, settings, and manual actions.
- Give every header button an accessible name, visible label, tooltip, and keyboard focus state.
- Use a `tablist` with real `button[role=tab]` elements for Entities, Queue, and Contra.
- Keep every existing tab action, entity disclosure, queue undo, contradiction scan, and entity desk action reachable.

## Inspect evidence bench

- Keep the empty rail quiet. Its vertical Inspect button opens a plain empty pane.
- When one fact is selected, split Inspect into three unboxed bands: Identity, Evidence, and Actions.
- Identity owns the fact ID, category, tags, content, and the three edit actions.
- Evidence owns trust, retrieval and helpful counts, timestamps, entities, vector state, export, algebra, backfill, and reason.
- Actions owns feedback, undo, typed-ID delete, and direct trust control.
- Separate bands with hairlines. Do not wrap them in cards.
- Keep aggregate evidence and all bulk actions for a multi-selection. Do not show single-fact edit or delete actions there.
- Guard each asynchronous `fact.get` result with an Inspect render generation and the current selected ID.

## Selection history

- Store at most 50 adjacent, distinct selection snapshots.
- A snapshot contains the complete ordered selected-ID set and the focused fact ID.
- Shift selection records the resulting complete multi-selection, not only the last clicked fact.
- A new selection after Back truncates the forward branch.
- Back and Forward restore the exact snapshot where possible.
- On restore, remove deleted IDs. Skip a snapshot when no selected ID still exists.
- Do not create a new history entry while restoring history.
- Put Back and Forward buttons in Inspect and expose their disabled state.
- Bind `Alt+Left` and `Alt+Right` to selection history only when focus is outside form fields and editable content.
- Do not handle the Alt arrows while a modal, find surface, trust popout, or context menu is open.

## Active Field context

- Show active entity highlights and an active trust lens in a semantic breadcrumb rail over the Field.
- Give each entity context its own clear button.
- Give the trust context its own clear button. Clearing trust must not clear entities, and the reverse.
- Number each entity probe attempt. Apply a probe response only when its generation is still current.
- Toggling or clearing an entity invalidates its pending probe.
- Clearing all entities invalidates every pending probe.

## Stream, errors, and action styling

- The collapsed Stream dock shows its labeled expand button and one live glance at the newest event.
- Build the glance from the existing Stream description. Insert its action and plain text with ellipsis.
- Update the glance once per event-state notification. Do not add another event-list renderer.
- The expanded dock shows the real journal rows.
- Keep journal order and per-event tracking. Deduplicate by event ID.
- Batch the initial journal tail into one state notification.
- Coalesce left-bench reactions to event bursts into one animation-frame render.
- On boot failure, preserve the themed shell and controls. Show the exact attach error with a clear Retry button.
- Style ordinary buttons as flat hairline controls.
- Reserve carved depth for primary and commit actions.
- Keep sharp corners, all ten theme rows, visible `:focus-visible` states, and reduced-motion behavior.
- Add no registration marks, decorative diagrams, or fake Field geometry.


## Read recovery and find surface

- Keep one active Find close function. Opening Find again must remove its click-away listener before replacement.
- Give each Find result a stable, unique option ID. Point `aria-activedescendant` at that ID without changing row IDs during navigation.
- Guard projection and entity reads with independent generations. A stale response must not overwrite a newer read.
- On each WebSocket hello after the first, refresh stats, projection, entities, and the journal gap after the newest known event.
- For a reconnect gap larger than 400 events, request the newest 400-event window and retain its latest event.
- Run one HTTP read sync during initial boot. A first WebSocket hello during that sync must not duplicate it.
- If HTTP boot completes before the first WebSocket hello, treat that late first hello as a reconnect and resync.
- Deduplicate journal events when a reconnect gap overlaps a live event.
- If a mutation refresh or reconnect sync fails, keep the current data, show degraded state, and offer a read-only Retry action.
- A failed asynchronous refresh must not create an unhandled promise rejection.

## Preserved contracts

- Field positions remain the server's real projection coordinates.
- Field updates remain dirty/event driven. This UI pass must not add a continuous draw loop.
- All existing mutation handlers remain available, including typed-ID deletion.
- The frontend continues to use the provider API. It does not read or write the database directly.
- UI verification uses synthetic fixtures. It must not send live requests or mutate the live database.
