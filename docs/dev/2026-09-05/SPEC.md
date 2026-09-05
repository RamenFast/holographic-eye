# D-0016 · Measured cockpit refinement (2026-09-05)

Status: candidate work on dev. Not deployed or released.

## Vision
Keep the Eye a calm, precise memory instrument. Make finding, reading, and retracing facts easier.
Retain the Field geometry, ten palette rows, and the separate garden lane.
Use clear hierarchy and restrained depth rather than decorative containers.

## Boundaries
- Preserve the live memory database, journal, bundled provider, Hermes core, and running sessions.
- Use synthetic fixtures for UI tests and published screenshots. Use isolated database copies for provider tests.
- Do not change schemas, vector math, retrieval semantics, or journal response immutability for performance.
- Database copies use SQLite backup and integrity checks, never file-copy a live WAL database.
- Keep recoverable copies of the installed shell and served frontend before deployment.
- Deploy static frontend changes separately from provider changes. A UI update does not require a gateway restart.
- Source/provider defects require isolated regression proof and a separate safe activation decision.
- Keep master push behind Ben's standing approval gate. GitHub dev updates can proceed after verification.

## Acceptance map
| Outcome | Required check |
|---|---|
| Easier navigation and reading | Synthetic real-input browser checks plus visual review |
| All themes and text scales | Ten-theme sweep; minimum desktop and large viewport; 85–125% scale |
| Honest error and empty states | Empty store, missing token, failed requests, disconnect/reconnect |
| Preserved mutation controls | Typed-ID deletion and duplicate-submit tests on fake RPC only |
| Faster hot paths | Same-fixture before/after measurements and correctness assertions |
| Memory preserved | Recovery copy integrity; offline provider regressions; no live mutation tests |
| Reproducible package | Version match, DEB/RPM payload checks, source archive and checksums |
| Installed app works | New installed CLI probes and private-Xvfb native WebKitGTK check |
| Honest completion | Independent review; release/installation receipts and remaining limits |

## Safety token
Blocked means a named failing check, its evidence, the best working candidate, and the next specific fix.
A build alone does not prove runtime behavior or authorize database changes.
