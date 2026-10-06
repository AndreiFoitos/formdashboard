# Redesign progress

Autonomous run on branch `redesign` (started 2026-10-06). DESIGN.md is binding;
decisions go to DESIGN.md §10. Audit script: greps for hex/rgb, inline fontSize,
inline spacing/radius numbers, off-scale text/spacing/radius classes, uppercase/tracking.

## Phase 0 — current state
Done. 24 files had real changes (8 more were line-ending-only). Audit of components/:
0 hex, 0 inline fontSize, 0 inline spacing, 0 off-scale classes; tsc passes.
Gaps found: title-case labels (e.g. "Log Stimulant"), UndoToast shadow (no shadows
on black), 2 circular images without borderCurve, pageSheet scroll views without a
bottom safe-area pad. Verdict: substantially complete → kept on `redesign`, gaps
closed in Phase 1.

## Phase 1 — §8 step 4 for components/
In progress: sentence case sweep, borderCurve gaps, sheet safe-area padding,
UndoToast shadow, then full audit of app/ + components/.
Done: sentence case ("Log stimulant", "Log body metrics", "Log meal", "Privacy policy"),
UndoToast shadow removed, audit of app/ + components/ at 0 except logged exceptions
(DESIGN.md §10). Edge-fixed components (OfflineBanner top inset, UndoToast bottom inset)
already inset-based. tsc clean.
