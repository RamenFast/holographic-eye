# Next UI pass · responsive exploration

Status: frontend and shell 1.2.0 are installed and verified. Provider/API 1.1.0 remains unchanged. Publication to master is awaiting approval.

## User outcome
Floating-view title bars remain visible and usable. Narrow windows do not clip essential controls.
The Field reveals readable fact content when zoom and free space permit it.
Category and timeline views make the same memory data easier to browse.

## Boundaries
- Keep the memory provider, databases, retrieval math, journal, and other sessions unchanged.
- Use existing loaded fact metadata for category and time browsing. Label missing dates and coverage honestly.
- Preserve the Zig hit kernel and its JavaScript fallback. Text overlays do not change coordinates or selection.
- Preserve the ten themes, accessibility, mutation safeguards, and dirty rendering.
- Use synthetic fixtures and private GUI displays for tests. Publish no personal-memory screenshots.
- Work on dev. Keep the existing release available until the next candidate passes.

## Required checks
- 640, 800, 1100, and 1440-pixel widths, at least480-pixel height, all four text scales.
- Dialog title and close control remain accessible with long titles and overflowing content.
- No unwanted focus transfer or Field keyboard action while a dialog/editor owns input.
- Zoom text appears when space permits, stays readable, avoids overlapping labels, and has bounded cost.
- Category/time navigation retains fact selection and Inspect history.
- Invalid dates, null vectors, empty data, unknown categories, Unicode and20k-fact fixtures stay usable.
- Existing107GUI/194transport/27backend/14Rust/7Zig contracts remain intact or have justified visual-test updates.

## Open clarification
Does the title-bar report refer to internal floating dialogs, native desktop window chrome, or both?
This does not block narrow-layout reproduction or exploration design.

## Component versions
The candidate frontend and native shell are1.2.0. The unchanged memory provider/API remains1.1.0.
Do not bump or restart the provider merely to match the interface version. This pass deploys frontend assets separately.
