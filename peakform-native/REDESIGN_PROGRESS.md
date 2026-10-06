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
Commit: 721a85c

## Phase 2 — §8 step 5, Settings rebuild per §6
Plan: components/settings/SettingsGroup + SettingsRow; routes app/settings/{index,profile,
units,training,nutrition,edit/[field]}; lib/units.ts (persisted metric/imperial, applied to
weight/height/water displays + inputs); lib/targets.ts (Mifflin-St Jeor shared with
onboarding, used by Profile recompute prompt); autosave everywhere, no Save buttons.
Done. Old → new mapping (every option kept):
| Old option | New place |
|---|---|
| Plan row (name, scans/questions/friends usage, renews date) | Subscription → Plan (value) + group footer (usage, renews) |
| Manage subscription (paid) | Subscription → Manage subscription |
| Restore purchases | Subscription → Restore purchases |
| Username | Top row → Profile → Username (modal, Done) |
| Protein / Water / Calorie targets | Goals & targets → Protein / Water / Calories (modal, Done) |
| Bedtime ± stepper | Goals & targets → Bedtime (form sheet, tap to save) |
| Save changes button | Removed: every value saves on Done/tap/toggle |
| Edit avatar | Avatar → Customize avatar |
| Predictive log reminders Turn on/off | Notifications → Smart nudges (switch) |
| Detected patterns preview | Notifications → Nudge times group (when on) |
| Pit Crew → Training & food (goal, training, food) | Goal → Goals & targets; Training preferences; Nutrition preferences |
| Your data → Trends | Removed from Settings per §6 (still on Today) |
| Export everything (CSV) | Privacy & data → Export data (CSV) |
| How is this calculated? | Help → How GainRace works |
| Labs → Avatar lab | Developer → Avatar lab (__DEV__ only) |
| Signed in as (email) | Profile → Account → Email |
| Sign out | Account → Sign out |
| Delete account (DELETE flow) | Separate group, danger |
| Privacy policy / Terms / Contact support | Help |
| Version (build) | Footer, centered |
New: Profile (age, sex, height + calorie recompute prompt), Units, Notifications permission row,
Show body shape to friends (mirrored from avatar edit). Units applied to Body, Training, Today,
Friends, Trends, Pit (plan, log sheet, check-in), weekly recap, onboarding (with a units toggle).
tsc clean.
