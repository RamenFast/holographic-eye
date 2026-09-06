# Holographic Eye 1.2.0

## Responsive exploration
- Explore, Evidence, and Inspect fit narrow windows down to 640×480.
- Floating dialog headers and close controls stay visible while content scrolls.
- Zoom can reveal bounded fact-content snippets where there is room. Text can be turned off.
- Categories and Timeline provide local filtering and paged browsing of loaded facts.
- Stored and Last updated dates are explicit UTC metadata, not event history. Missing and invalid dates remain Unknown.

## Safety and scope
The frontend and native shell are 1.2.0. The provider/API remains 1.1.0. This update does not change retrieval math, database schemas, or mutation safeguards. Existing 1.1 installations need only the new shell and frontend assets, with no gateway restart.

All 981 responsive and 107 legacy GUI checks passed. Native WebKit checks passed against the exact DEB using synthetic data on a private display/network. See VALIDATION.md for full coverage and performance limits.

The longer warmed component comparison preserved exact pixels and hits and did not reproduce the short-run median draw slowdown. Tail variability remains. At 20,000 facts, cold label layout can exceed the 8ms target. RPM payload availability is not a claim of a Fedora runtime installation.

Publication is pending approval.
