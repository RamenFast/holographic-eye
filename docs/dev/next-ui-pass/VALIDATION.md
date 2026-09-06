# Responsive exploration validation

Candidate: frontend and native shell 1.2.0, candidate 5.
Frontend and shell 1.2.0 are installed. Provider/API 1.1.0 is unchanged and was not restarted.

## Passed
- 981 responsive checks: 600 Explore cells, 320 Evidence/selected Inspect cells, and 61 functional checks.
- 107 existing GUI workflow checks, using synthetic mutation endpoints only.
- 194 transport checks.
- 27 offline backend checks using temporary synthetic databases.
- 15 Explorer model/controller checks.
- Seven Zig unit tests.
- 14 native Rust tests, Clippy, formatting, and deb/rpm builds.
- Exact canvas hash and hit-test parity with labels off in the component benchmark.

Responsive coverage includes ten themes, four text scales, narrow windows, visible initial data, fixed dialog headers, focus, category/date edge cases, first Field fit after hidden startup, and resize handling before paint.

## Evidence
- `build/verify/shots/next-ui/candidate-5-final/report.json`
- `build/verify/shots/next-ui/candidate-5-final/pane-matrix.json`
- `build/verify/shots/gui-edge/v12-final/report.json`
- `build/verify/perf_frontend.candidate5.json`
- Private recovery and logs: `/media/ben/Mass storage/agenticTinkering/claude/holographic-eye/2026-09-05-responsive-exploration/`

## Performance limits
The initial component comparison preserved exact output but measured variable draw overhead: median 5.6 to 7.3ms. It used only five timed draws per browser without dedicated warmup. A longer measurement used six alternating-order pairs, 20 untimed warmup draws and 40 recorded draws per arm. Median draw time was 4.7ms baseline versus 4.6ms candidate; median per-run p95 was 5.7 versus 6.1ms. It did not reproduce a sustained median regression, but tail variability remains. The first result remains part of the record. Both measurements time synchronous canvas commands with labels off, not frame presentation or whole releases.

Separate label-layout measurements used a fixed synthetic camera: warmed p95 was 1.5ms at 1,500 facts, 1.6ms at 5,000, and 6.6ms at 20,000. The 20,000-fact cold layout was 14.3ms. Earlier warmed runs reached 10.1ms, so the 8ms target is not a universal bound.

## Installation verified
The installed executable matches the exact tested DEB. Every served frontend file matches candidate 5. Provider files outside the frontend are unchanged. The gateway retained PID 4025645. Recovery copies remain available. No database changes or service restart were performed.

The initial APT attempt failed before installation; direct installation of the verified DEB succeeded. The frontend directory was exchanged atomically with a verified staged copy. Publication remains a separate approval decision.

Chromium screenshots do not prove native decorations or WebKit behavior. No personal-memory screenshot is public evidence.

## Native verification
Both the release binary and the exact extracted DEB executable passed 9/9 checks in native WebKit with Openbox, private Xvfb, and a private user/network namespace. The synthetic server was isolated from the live provider. Checks covered the 640×480 minimum, zero client overflow, Field/Categories/Timeline, a long header with 2,537px of body scrolling, Escape, and zero mutations.
The first Escape attempt used XSendEvent, which GTK ignored. The failed receipt is retained. XTEST input passed without product changes.
Receipts: `build/verify/shots/next-ui/native-candidate5/` and `native-deb-candidate5/`.
