# Holographic Eye 1.3: label and color audit

Status: source audit only. No application changes, live data, GUI launch, or runtime verification.

## Findings

- `build/eye_frontend/src/field-labels.ts`, `FieldLabels.layout`: anchors try right, left, above, then below. Labels carry no connector. A nearby label can appear to belong to another dot.
- The layout has no zoom tier. Scale changes available space, but sparse fitted views can already show 48 two-line content labels. This explains why zoomed-out text can dominate.
- Labels always use `f#ID · content`. Loaded `Fact` also supplies category, tags, and entities. Full content is unnecessary for useful context.
- `field.ts` paints every label at 95% ink opacity, even when its dot is dimmed by entity, trust, or Reason context. This can invert visual priority.
- `modals.ts`, `legendHtml`: a color key exists only inside the `?` manual. It samples trust 0.75 with alpha 1, unlike Field opacity. “Pink ring”, “gold ring”, and saturation-only trust language are incomplete across ten themes.
- The manual says Reason hits “would be recalled”. Actual membership is the current returned result set filtered by the Workbench threshold. The request has `limit: 20`. Do not imply exhaustive recall or hidden reasoning.
- `PLAN.md` Part 6 contains older age-opacity and category-color rules. Current code uses trust-opacity and newer category hues. D-0010, D-0011, D-0018 and the next-pass spec preserve current rendering and themes.

Sources read: project AGENTS, FEEDBACK, README, relevant PLAN sections, `docs/dev/next-ui-pass/SPEC.md`, Field/state/modal sources, frontend HTML/CSS, and `build/verify/test_field_labels.cjs`. Ben's context and UI standards govern this proposal. Parent owns feedback-ledger integration.

## Proposed rules: whole first, context on zoom

Use `z = scale / fitScale(viewWidth, viewHeight)`, not raw PCA scale. Preserve the existing 0.5–8 clamp and camera transforms. Recompute the ratio after resize and bounds changes without moving the camera.

| Zoom | Ordinary labels | Content per label | Maximum width |
|---|---:|---|---:|
| 0.5 ≤ z < 1.25 | 0 | None | Not used |
| 1.25 ≤ z < 2.5 | 12 | One line: ID + first entity, else tags, else content excerpt | 152 × ui |
| 2.5 ≤ z < 4 | 24 | Two lines: ID + content excerpt | 208 × ui |
| 4 ≤ z ≤ 8 | 48 | Two lines: ID + excerpt; add entity/tag context only in remaining space | 208 × ui |

These are ceilings, never quotas. Exact thresholds avoid extra animation or timer state. Deterministic ties use fact ID, with the existing spatial bins for ordinary coverage.

At every zoom, consider hover first, then focused selection, then other selected facts, then entity/Reason hits, then ordinary candidates. Below 1.25, allow at most two intentional labels: hover and focused selection, each one line. They are exceptions, not automatic overview text. At other tiers, exceptions consume the tier budget. `Text: off` removes canvas labels, not Inspect or hover access.

For a concrete synthetic fact, `f#0042`, content “Use a local index for garden notes”, entity “garden”, the overview is silent. The first tier can show `f#0042 · garden`. The next can show `f#0042 · Use a local index…`.

Only show loaded source text. Treat tags as their stored string unless an existing parser defines their structure. Use category as the final fallback, then ID alone. Do not fabricate summaries, entity relationships, or reasoning. An optional context suffix may say “Reason result” only for membership in `reasonHalo.factIds`. Scores require actual retained response values, not inference from color or proximity.

Do not label ordinary facts suppressed by active entity, trust, or Reason contexts. Explicit hover/selection can override this rule. Invalidate layout on those context changes. Keep exact trust-lens predicates: above uses `>=`, below uses `<`.

## Proposed anchoring contract

1. Keep all dot coordinates, radius calculations, hit testing, selection and pan/zoom behavior unchanged.
2. Use CSS-pixel screen coordinates. Let `R = nodeRadius + 7`, retaining current ring clearance.
3. Center each label below its node: `left = sx - width/2`, `top = sy + R + 8*ui`.
4. Try the tier's permitted content, then a shorter one-line fallback. Never move text beside or above a node.
5. If the rectangle crosses the six-pixel viewport inset, another label, dot clearance, or overlay exclusion, omit it. Do not clamp it sideways.
6. Draw a thin vertical stem from below the node's outer ring to the label's top center. Reject a stem crossing another node or accepted label. It has no hit target.
7. Keep font 12 × ui, line height 16 × ui, padding 3 × ui, and grapheme-safe ellipsis. Do not shrink text to fit.
8. Reserve all existing chrome, tooltip, mathlog and vectorless-strip exclusions. A visible tooltip replaces its hovered node's canvas label to avoid duplicate descriptions.

Trap: moving text below but retaining side fallbacks leaves the reported ambiguity intact. Another trap is forcing every selected label into a dense cluster. Omission plus Inspect is more truthful than displaced text. A less obvious useful choice is entity-first one-line context, rather than ever-longer fact text. Its cost is that repeated entities can look alike, so keep the ID.

## Discoverable color key

Add a visible `Color key` text button beside `Text: auto`. It opens the existing manual directly at the canonical Field key. Keep one source of key content, not a second legend. Use the existing persistent, sharp-corner modal, explicit close, Escape, click-away, focus restoration, and scrolling. No hover-only panel or pill. At narrow widths the button must remain reachable through toolbar wrapping.

Generate category samples with `catColor(category, trust, 0.55 + trust*0.45)` on the actual Field surface. Show labeled columns for trust 0, 0.5, and 1, with no context dimming. Enumerate loaded categories plus known canonical categories. If counts are shown, distinguish loaded counts from stats totals.

Actual category mapping in `state.ts`:

| Category | Hue / base saturation |
|---|---|
| user_pref | 338 / 45 |
| project | 205 / 30 |
| tool | 0 / 0, lighter neutral |
| general | 0 / 0, darker neutral |
| lesson | 140 / 15 |
| seed | 30 / 25 |
| session | 270 / 15 |
| Other names | Deterministic hash into 180/20, 60/20, 300/18, 110/18 |

Call `catColor`, do not copy its formula into the key. Different categories can share a color. Tool/general are achromatic and cannot express trust through saturation. Higher trust brightens dark-theme dots and deepens light-theme dots. Trust also changes opacity. Opacity does not currently encode age.

Use token-colored ring samples with text: `acting` = selected (r+4), hovered (r+3), or entity-highlighted (r+3). `numerics` = returned Reason result passing the current threshold (r+5). The separate breathing entity-centroid ring is context, not a fact or a hit target. Explain context dimming: entity nonmatches ×0.12, Reason nonmatches ×0.35, trust-lens nonmatches ×0.07. These factors combine.

Show size samples from `clamp(2 + ln(1 + retrieval_count)*1.5, 2, 8)` for counts 0, 5, 50. Label these journal-observed recalls, not importance or lifetime counts. Explain hollow bottom-strip rings as facts without vectors. Explain position as PCA projection, not causal links or a reasoning trace.

## Synthetic acceptance checks for implementation

These are proposed checks, not executed results.

- Sparse fixture at z=0.5 and 1: zero ordinary labels. At 1.25, 2.5, 4 and 8: tier caps and content limits hold. Test immediately below each boundary. Fit returns to silent overview.
- Two intentional overview labels maximum. More than 256 selected facts cannot starve hover/focused selection. Dense and coincident nodes can omit labels without moving nodes.
- Every accepted label centers under its owning dot within 0.5 CSS px. Test stems, all four viewport edges, overlapping nodes, overlays, tooltip replacement, and vectorless strip.
- IDs/content match the owning fixture after pan, zoom, selection, updates and theme changes. Empty content, tags-only, entities-only, unknown categories, null coordinates, combining marks and emoji remain truthful and bounded.
- Compare coordinate buffers and WASM/JavaScript picks before/after text and key toggles. Label/stem clicks gain no new selection targets. Check region selection and pointer-centered wheel behavior.
- Test 640/800/1100/1440 widths at height 480+, scales 0.85/1/1.1/1.25, all ten themes, DPR 1 and 2, reduced motion and forced colors. Text contrast target is 4.5:1. Category names and numeric trust values keep the key usable without color.
- Verify key open/close/focus, keyboard guards, and theme repaint while open. Key samples equal `catColor` outputs and token ring colors. Unknown-category collisions remain named. No new RPC is needed.
- Retain 256 candidate, 48 accepted, 2048 cache-entry and 180 shaped-grapheme ceilings. Include context/tier/source revisions in cache validity. Same-state draws cause no layout rebuild.
- Use synthetic 20k-fact dense and sparse fixtures. Enforce warmed layout p95 ≤8 ms on the same runner and compare before/after whole-frame cost. Existing test prints `targetMs: 8` but does not assert it. No new idle frames: retain zero draws over five seconds without active effects. Hidden/zero-sized Field remains dormant.
- Add a multi-megabyte-content case. Current `wrapLabel` normalizes the whole string before the 180-grapheme cap, so shaping is bounded but preprocessing is not. A bounded source scan should report truncation honestly and preserve graphemes.

The implementation needs synthetic visual and timing proof. This read-only audit makes no native WebKitGTK or runtime performance claim.
