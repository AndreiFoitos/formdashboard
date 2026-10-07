# GainRace — Design System & App Structure

This file is binding. Every UI change in `peakform-native/` must follow it.
If a change needs something this file doesn't define, stop and propose an
addition to this file first — do not invent one-off values.

---

## 1. Hard rules

1. No hex, rgb or rgba literals in `app/` or `components/`. Colors come from tokens only.
   Exempt from rule 1: all of `lib/avatar/` (avatar content), `SusFace.tsx` and `TrustedShield.tsx`
   (illustration art), `SsoButtonsImpl.tsx` (Apple/Google brand guidelines — never restyle).
2. No inline `fontSize`, `padding`, `margin`, `gap` or `borderRadius` numbers. Use the scales below via NativeWind classes.
3. Only the type sizes in §3 exist. Only the spacing steps in §4 exist.
4. Every tappable element is at least 44×44 pt.
5. One accent color. Accent marks primary buttons, the active tab, progress bars and key CTAs. Selected chips/segments use white fill (`bg-text` / `text-bg`).
6. Dark only. `app.json` → `"userInterfaceStyle": "dark"` so system UI (alerts, keyboard, pickers, share sheet) matches.
7. Labels describe what a thing does in plain words. No internal or brand jargon in settings ("Pit Crew", "Labs").
8. Sentence case everywhere. No ALL-CAPS labels.
9. Accent (#2c66fb) on bg is 4.40:1: use it only for icons, text >= 18pt, or semibold text >= 14pt. Small links/labels on black use text, not accent.
10. Button text on accent is white, >= 16pt or semibold.
11. Project is on Expo SDK 54 / expo-router 6. Skills may describe SDK 56 APIs; always use the SDK 54 equivalent. Do not upgrade the SDK during the redesign.
12. No scroll indicators. Every `ScrollView`, `FlatList` and `SectionList` sets `showsVerticalScrollIndicator={false}` and `showsHorizontalScrollIndicator={false}`.

---

## 2. Color tokens

`accent` is sampled from the app icon (`assets/icon.png`).

Defined once in `theme/tokens.ts`, wired into `tailwind.config.js` (see §7).

| Token | Hex | Use |
|---|---|---|
| `bg` | `#000000` | App background |
| `surface` | `#18181b` | Cards, sheets, list groups |
| `surface-raised` | `#27272a` | Inputs, pressed rows, chips |
| `divider` | `#27272a` | Hairlines, card outlines, row dividers, chart axes |
| `border` | `#3f3f46` | Input outlines, grab handles |
| `text` | `#fafafa` | Primary text |
| `text-muted` | `#a1a1aa` | Secondary text, row values |
| `text-subtle` | `#71717a` | Captions, placeholders, disabled |
| `accent` | `#2c66fb` | Brand blue from the app icon. Primary buttons, active tab, progress |
| `on-accent` | `#ffffff` | Text/icons on accent (4.77:1; black would be 4.40:1) |
| `success` | `#22c55e` | Goals hit, positive deltas |
| `warning` | `#f59e0b` | Approaching limits |
| `danger` | `#ef4444` | Destructive actions, errors |

Dividers on `bg`/`surface` use `divider`; on `surface-raised` use `border`.

### Chart, scale and badge colors

Use these only in charts, scales and badges, never for UI chrome or text.

| Group | Tokens |
|---|---|
| `score` | `low` #ef4444, `midLow` #f97316, `midHigh` #eab308, `high` #22c55e |
| `data` | `protein` #818cf8, `carbs` #34d399, `fat` #fbbf24, `water` #38bdf8, `weight` #fafafa, `bodyfat` #a78bfa, `form` #2c66fb, `volume` #fafafa |
| `muscle` | `chest` #f87171, `back` #34d399, `legs` #f472b6, `shoulders` #60a5fa, `arms` #a78bfa, `core` #facc15, `other` #a8a29e |
| `medal` | `gold` #FCD34D, `silver` #D1D5DB, `bronze` #B45309 |
| `rarity` | `common` #a1a1aa, `rare` #38bdf8, `epic` #c084fc, `legendary` #facc15 |
| `racer` | `sky` #38BDF8, `emerald` #34D399, `amber` #FBBF24, `rose` #F472B6, `violet` #A78BFA, `coral` #FB7185 |

Token groups are scoped: `score`/`data`/`muscle`/`medal`/`rarity`/`racer` are never borrowed outside their purpose. Missing a color = propose a token.

Classes: `bg-score-high`, `text-data-protein`, etc. Raw values: `colors.muscle.chest`.

Migration map for existing literals:
- `#000`, `#000000` → `bg`
- `#18181b` → `surface`; `#27272a` → `surface-raised`
- `#fff`, `#ffffff`, `#fafafa` → `text`
- `#71717a` → `text-subtle`; `#a1a1aa` → `text-muted`
- Existing blues that are the brand color → `accent`
- `#0b62e8` (expo-notifications color in `app.json`) → `accent`
- `#facc15`, `#fbbf24` and other yellows → `warning` if they signal caution; otherwise remove (yellow is no longer the accent)
- `lime`, `emerald`, `green` → `success` unless it is a data-viz series
- `#27272a` / `zinc-800` as a border, divider or chart axis → `divider`
- `zinc-600`, `zinc-700`, `#52525b` text/placeholders → `text-subtle`
- `zinc-950` → `surface` for sheets, `surface-raised` for cards inside sheets and inputs
- Data-viz series colors → the `score` / `data` / `muscle` / `medal` / `rarity` / `racer` groups above.
  A new series gets a named token there — don't scatter hex.

---

## 3. Type scale

System font (SF Pro on iOS). Seven sizes, no others.

| Class | Size / line height | Weight | Use |
|---|---|---|---|
| `text-caption` | 12 / 16 | 500 | Captions, timestamps, tab labels |
| `text-footnote` | 14 / 20 | 400 | Secondary row text, helper text |
| `text-body` | 16 / 22 | 400 | Default body, list row titles |
| `text-headline` | 18 / 24 | 600 | Card titles, section headers |
| `text-title` | 24 / 30 | 700 | Screen titles |
| `text-display` | 32 / 38 | 700 | Key numbers (calories left, score) |
| `text-hero` | 48 / 52 | 800 | One hero number per screen, max |

Existing inline sizes 9, 10, 11 → `text-caption`. 13 → `text-footnote`. 22 → `text-title`. The one exception is the 160pt self-timer countdown in `body-comp-snap.tsx`: it overlays the camera and is read from 2–3 m away.

---

## 4. Spacing, radius, elevation

Spacing (4-pt grid): `1`=4, `2`=8, `3`=12, `4`=16, `5`=20, `6`=24, `8`=32, `12`=48.
Off-scale values (1, 3, 5, 7, 18, -11, …) get rounded to the nearest step.

- Screen horizontal padding: `px-4` (16).
- Gap between cards: `gap-3` (12). Gap inside a card: `gap-2` (8).
- Section spacing on a screen: `mt-6` (24).

Radius: `rounded-md` 8 (buttons, inputs), `rounded-xl` 16 (cards, list groups, sheets), `rounded-full` (avatars, pills). Nothing else, except chart marks below.
Anything picked one-of-several (segmented controls, choice and filter chips) is rounded-full. Buttons and inputs are rounded-md. Chart marks (bars, segments) may use radius 2-4 and 1px gaps.
All rounded surfaces use `borderCurve: 'continuous'` via style prop.
Selectable cards (multi-line options) stay rounded-xl.
Controls overlaid on full-screen camera/media are rounded-full.
Clearances for fixed/floating elements use constants from `theme/layout.ts`, never raw numbers.
Anything fixed to the top or bottom edge offsets from safe-area insets, never fixed padding.
`letterSpacing` is allowed only on codes (invite codes, barcode input).

Elevation: no shadows on black. Separate layers with `surface` vs `bg`, and hairline `border` where needed.

---

## 5. Navigation

### Tab bar
Five tabs (Apple's maximum). A **custom bottom bar** (`components/BottomNav`) on material-top-tabs, with **swipe between tabs** — chosen after on-device review over native tabs (2026-10-07): swiping between tabs is core to how the app feels, and native tabs can't swipe.

Bar spec, tokens only:
- Background `bg`, top hairline in `divider`.
- Icon + `text-caption` label per tab. Active = `accent`, inactive = `text-subtle`.
- A 2pt `accent` line above the active tab that follows the pager's live position while swiping.
- Row height 49pt (`TAB_BAR_HEIGHT`) + bottom padding `Math.max(insets.bottom, 8)`; every tab is a ≥44pt target.
- Light haptic on tab press.
- Horizontal gestures inside a tab (swipe-to-delete rows, horizontal scrollers) win over tab swiping: they take a lock on touch-down (`useTabSwipeLock` in `store/tabSwipe.ts`) and tab swiping is off while any lock is held.

| # | Label | Icon idea | Content |
|---|---|---|---|
| 1 | Today | house / sun | Daily overview |
| 2 | Training | dumbbell | Workouts, logging |
| 3 | Nutrition | fork-knife | Food logging, snap, barcode |
| 4 | Body | figure | Body comp, measurements |
| 5 | Pit | chat bubble / sparkles | Plan + Chat |

"Pit" is core to the brand and stays as the tab name. Its icon must make the meaning obvious (AI coach / chat), and the Pit screen's empty state should say in one line what it does.

### Presentation rules
- Drill-down (settings, detail, trends, friends) → stack push with a native header and back button. No headerless screens except the tab roots and full-screen media (camera).
- Task that is completed or cancelled (logging, snap, barcode, paywall) → modal sheet with a Cancel/Done in the header.
- Short choice or confirmation → bottom sheet or native Alert.
- Every pushed screen has a title in the header.

### Implementation (SDK 54)
- Wrap the app in React Navigation's `ThemeProvider` pinned to `DarkTheme`, with colors from `theme/tokens.ts`, so native headers and sheets render dark.
- Pushed screens use standard header titles via `options={{ title }}`, not large titles. Tab roots stay headerless with a `text-title` heading.
- Root stack stays above the tabs (pushed screens cover the tab bar).
- Tabs: material-top-tabs (`tabBarPosition="bottom"`, custom `BottomNav`, `swipeEnabled` gated by the swipe lock). `OfflineBanner` and `PolicyUpdateNotice` live in the root layout, not the tabs layout.
- Tasks: presentation `'modal'`. Short choices: presentation `'formSheet'` with detents and background color = `surface` (no transparent/glass).
- Do not use `@expo/ui` on SDK 54; build settings with our own components and the RN `Switch` colored from tokens.

### Cleanup
- Delete `App.tsx` (unused starter template).
- Remove or wire up `programs` (currently unreachable).
- Hide `avatar-lab` and the Labs row entirely in production builds (`__DEV__` or EAS profile check), not only behind a flag.

---

## 6. Settings

Entry point: avatar + gear in the Today header top-right (keep current placement). Settings is the single hub — every user-configurable option lives here or one level below.

Settings uses the iOS inset grouped list pattern: rounded `surface` groups on `bg`, `text-body` row titles, `text-muted` current value on the right, chevron for drill-down, native `Switch` for toggles. Section headers in `text-footnote` / `text-subtle`, sentence case.

```
[ Avatar   Username                    > ]   → Profile
   Free plan · Upgrade

Goals & targets
  Goal                       Cut         >
  Calories                   2,200 kcal  >
  Protein                    160 g       >
  Water                      3,000 ml    >
  Bedtime                    23:00       >

Preferences
  Training preferences                   >   (equipment, experience, session length, injuries)
  Nutrition preferences                  >   (diet, allergies, avoided foods, cooking effort, health flags)
  Units                      Metric      >   NEW

Avatar
  Customize avatar                       >   (opens avatar-edit)

Notifications
  Notifications              On/Off      >   (permission status; deep-links to iOS Settings if denied)
  Smart nudges               [switch]

Subscription
  Plan                       Free        >   (paywall / manage)
  Restore purchases

Privacy & data
  Show body shape to friends [switch]        (moved from avatar-edit; keep a mirror there)
  Export data (CSV)          Pro         >

Help
  How GainRace works                     >   (methodology)
  Contact support
  Privacy policy
  Terms of service

Account
  Sign out

  Delete account                              (separate group, danger color)

Version 1.x.x (build n)                       (text-subtle, centered)
```

### Profile screen (from the top row)
Username, age, sex, height — **age, sex, height are new here** (currently onboarding-only). Saving any of these must recompute dependent values (BMI, targets) or ask whether to.

### What moves where
| Option | From | To |
|---|---|---|
| Goal cut/maintain/bulk | Preferences | Goals & targets |
| Equipment, experience, session, injuries | Preferences ("Pit Crew") | Training preferences |
| Diet, allergies, foods, effort, health flags | Preferences ("Pit Crew") | Nutrition preferences |
| Body shape privacy | Avatar edit | Privacy & data (mirrored in avatar edit) |
| Send test notification | Settings | Dev builds only |
| Trends link | Settings | Remove (Trends is content, reached from Today) |
| Trends range 30d/90d/1y | Trends | Stays on Trends (view control, not a setting) |
| Avatar lab | Settings → Labs | Dev builds only |

### Save behaviour
No global "Save" button. Each value edits on its own screen or sheet and saves when confirmed (Done) or on toggle. Show inline errors if the server rejects a change.

---

## 7. Implementation

`theme/tokens.ts`
```ts
export const colors = {
  bg: '#000000',
  surface: '#18181b',
  'surface-raised': '#27272a',
  divider: '#27272a',
  border: '#3f3f46',
  text: '#fafafa',
  'text-muted': '#a1a1aa',
  'text-subtle': '#71717a',
  accent: '#2c66fb',
  'on-accent': '#ffffff',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  score: { low, midLow, midHigh, high },          // §2 chart/scale/badge groups
  data: { protein, carbs, fat, water, weight, bodyfat, form, volume },
  muscle: { chest, back, legs, shoulders, arms, core, other },
  medal: { gold, silver, bronze },
  rarity: { common, rare, epic, legendary },
  racer: { sky, emerald, amber, rose, violet, coral },
} as const;

export const fontSize = {
  caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
  footnote: ['14px', { lineHeight: '20px' }],
  body: ['16px', { lineHeight: '22px' }],
  headline: ['18px', { lineHeight: '24px', fontWeight: '600' }],
  title: ['24px', { lineHeight: '30px', fontWeight: '700' }],
  display: ['32px', { lineHeight: '38px', fontWeight: '700' }],
  hero: ['48px', { lineHeight: '52px', fontWeight: '800' }],
} as const;
```

`tailwind.config.js`
```js
const { colors, fontSize } = require('./theme/tokens');
module.exports = {
  // ...existing content/presets
  theme: {
    extend: {
      colors,
      fontSize,
      borderRadius: { md: '8px', xl: '16px' },
    },
  },
};
```
For the few places that need raw values (react-three-fiber, SVG charts, `Switch` trackColor), import from `theme/tokens.ts` — never retype the hex.

---

## 8. Work order

Do these as separate commits/PRs, verify on device/simulator after each.

1. `app.json` → `userInterfaceStyle: "dark"`. Delete `App.tsx`. Remove/wire `programs`.
2. Add `theme/tokens.ts` + Tailwind config. No visual changes yet.
3. Sweep colors file-by-file to tokens (screens first, then components). Screenshot before/after.
4. Sweep type sizes and spacing to the scales. Add the borderRadius override (md 8px, xl 16px) here; it changes existing rounded-md/rounded-xl usages, so review corners on device.
5. Build reusable `SettingsGroup`, `SettingsRow` (chevron / value / switch / destructive variants). Rebuild Settings per §6. Add Profile and Units screens.
6. Add native headers to pushed screens. (Native tabs were tried here and reverted after device review; see §5 and §10.)
7. Rename user-facing jargon in settings ("Pit Crew" → Training / Nutrition preferences, remove Labs). The Pit tab keeps its name.
8. Final pass: every screen against §1 rules; run a grep for `#[0-9a-fA-F]{3,6}` and `fontSize:` in app/ and components/ — target zero.

---

## 9. Polish backlog

Agreed, not implemented yet. Each item still follows §1–§8.

- One number formatter app-wide: consistent thousands separators, a space before units.
- Friends: one label, "Find friends". Entry points are the Today race card and the Training Friends button only; remove the extra Training invite CTA.
- Today race card shows "Sep 28 — Oct 4" on Oct 6: label it as last week, or fix the range.
- Training range chips: move them inside the card they filter.
- Today settings icon: gear, not sliders.
- "Scan BF" → "Scan body fat".
- Pit header: title "Pit" with the date line above it, like the other tabs.
- Macro tiles: consistent — all with target bars, or all compact.
- Food names: capitalize the first letter on display.

---

## 10. Decision log

One line per decision made during the autonomous redesign run (2026-10-06).

- Phase 0: the uncommitted components/ sweep was audited as complete (0 grep hits, tsc clean) and kept on `redesign`.
- Exception: chart marks keep inline `borderRadius: 4` and `gap-px` (nutrition macro bar, training volume bars) — §4 allows radius 2-4 and 1px gaps on chart marks.
- Exception: SVG `<Text fontSize={fontPx('caption')}>` in charts — SVG text can't take classes; `fontPx` reads the §3 scale.
- Exception: `fontSize: 160` self-timer countdown in `body-comp-snap.tsx` (named in §3).
- Exception: `letterSpacing` on invite tokens (`friends.tsx`) and barcode input (`nutrition-barcode.tsx`) — codes, allowed by §4.
- Exception: "DOTS" (powerlifting score acronym) and the typed "DELETE" account-deletion confirmation stay upper case; they are an acronym and a literal string, not labels.
- Exception: RN `<Image>` style has no `borderCurve`; circular avatar heads in recap canvases go without it (no visual effect on full circles).
- Kept as proper names in title case: "Combo Dex" (feature name), "Open Settings" (iOS Settings app), "Hide My Email" (Apple feature), exercise names (data).
- UndoToast drops its shadow (§4: no shadows on black); it already separates with `surface-raised` + `border`.
- Scroll content inside pageSheet modals ends with `mb-12` (48 ≥ home-indicator inset); not edge-fixed, so no inset math.
- Phase 2: Settings sub-routes live under `app/settings/` (`index`, `profile`, `units`, `training`, `nutrition`, `edit/[field]` modal, `choose/[field]` form sheet); `app/preferences.tsx` became `settings/training` + `settings/nutrition`.
- Phase 2: single-value number/text edits use a `modal` with Cancel/Done (keyboard-safe); pick-one choices (goal, sex, bedtime) use a `formSheet` that saves on tap. RN-screens formSheets don't show a native header, so sheets draw a `text-headline` title.
- Phase 2: SettingsGroup gets a `raised` tone (surface-raised + `border` hairlines) for groups inside surface sheets, per §2 divider rule.
- Phase 2: Switch on-track uses `accent` (one accent; it marks state like the active tab), off-track `border`, thumb `text`. Avatar edit's switches now match.
- Phase 2: Units are a device-local setting (SecureStore), metric default; the API stays metric. Food macros stay in grams. Imperial lift input is rounded to 0.05 kg on save so unchanged values round-trip.
- Phase 2: Bedtime keeps the app's 12-hour format ("11:00 PM") rather than §6's illustrative "23:00", matching nudge times elsewhere.
- Phase 2: Goal, sex, age and height changes offer the recomputed calorie target (Mifflin-St Jeor, shared in `lib/targets.ts`) via an Alert; protein/water follow bodyweight only so they're untouched.
- Phase 2: Smart nudges switch off is remembered locally (`nudges_off`) so app start no longer re-registers the push token after the user turned nudges off.
- Phase 2: "Send test notification" (§6 table) doesn't exist in the codebase; nothing to move. `FEATURES.avatarDevTools` is now unused (Avatar lab is `__DEV__`-only) — kept, not deleted.
- Phase 2: Onboarding stats step gets a Metric/Imperial toggle (same store as Settings → Units) so imperial users can enter lb and ft/in.
- Phase 3: native tabs work on SDK 54 (`expo-router/unstable-native-tabs`, alpha). Android icons use `VectorIcon` + MaterialIcons because SDK 54 has no `md` prop; added `@expo/vector-icons` (JS-only, SDK-matched via `expo install`). Removed `@react-navigation/material-top-tabs` and `react-native-pager-view` (only used by the swipe tabs).
- Phase 3: tab bar tint = `accent` (active tab, §1.5), inactive = `text-subtle`, Android bar = `surface`.
- Phase 3: tab bar height can't be measured, so `theme/layout.ts` gains `tabBarClearance` (iOS: inset + 49pt; Android: 0) for content pinned to a tab's bottom — Pit chat input and UndoToast.
- Phase 3: SF Symbols — Today `house`/`house.fill`, Training `dumbbell.fill`, Nutrition `fork.knife`, Body `figure`, Pit `bubble.left.and.text.bubble.right` (chat = AI coach, §5).
- Phase 3: Camera screens (snap, barcode, body-comp) stay headerless full-screen pushes (§5 media exception); login/register/onboarding stay headerless as the signed-out flow.
- Phase 3: Paywall is a native modal titled "Plans" with Cancel; methodology topic sets its title at runtime.
- Phase 4: Weekly race date is intentional (last completed Mon–Sun week, per backend `_recap_week_bounds`); labelled "Last week · …" / "This week · …" instead of changing the range.
- Phase 4: Friends entry points = Today race card + Training "Find friends" button. The Training race card is no longer tappable; the invite CTA inside it is removed (Friends screen still reachable from both entry points).
- Phase 4: Range chips filter both PR progression and History; they sit inside the PR card and History shows "last N days". Chips get a 44pt min height and `surface-raised` fill inside the card.
- Phase 4: Macro tiles are all compact (no bars): value + one caption — protein "of 160 g" (target), carbs/fat "% of calories". The macro split bar below carries the visual; the protein target bar still lives on Today.
- Phase 4: "Pit Crew" stays in Pit-tab content, the paywall and the policy notice (product/legal copy, outside Settings); §1.7 only bans it in settings.
- Phase 4: Food name capitalization is display-only; stored names and edit fields keep what the user typed.
- Phase 5: Undersized buttons get `hitSlop={10}` to reach 44pt rather than growing their visual size.
- Phase 5: Native tab labels use `accent` at the system tab-label size — the system tab bar's own tint behavior, accepted as a rule 9 exception (rule 5 names the active tab as an accent use).
- Phase 5: Inputs and buttons moved to `rounded-md`; multi-line selectable cards and list rows in pickers stay `rounded-xl` (§4).
- 2026-10-07: Native tabs reverted to a custom swipeable bar on material-top-tabs after on-device review (swipe between tabs matters more than the system bar). Kept from Phase 3: native headers, ThemeProvider/DarkTheme, OfflineBanner/PolicyUpdateNotice in the root layout. `@expo/vector-icons` removed (only the native tabs used it); `expo-font` stays.
- 2026-10-07: `expo install` resolved material-top-tabs ^7.8.0, which lifts `@react-navigation/native` to 7.5.0 — one deduped copy, inside expo-router 6's `^7.1.8` range; expo-doctor passes.
- 2026-10-07: Swipe conflict: horizontal gestures inside tabs lock tab swiping on touch-down (`useTabSwipeLock`, ref-counted, released on touch end/cancel/unmount), because the pager is a native scroll view that RNGH gestures can't express relations with. Touch-down (not swipe-start) is used so the lock lands before the pager's pan recognizer moves. Trade-off: a horizontal swipe that starts on a swipeable row swipes the row, not the tab. SwipeableRow uses it; no horizontal scrollers live inside tab pages today.
- 2026-10-07: `tabBarClearance` is 0 now: the custom bar takes layout space below the pages.
- 2026-10-07: Tab bar enlarged to 56pt / 26pt icons after device review; tune via theme/layout.ts constants. (Was 49pt row, 24pt icons, 4pt label gap, 2×32pt square indicator; now `TAB_BAR_HEIGHT` 56, `TAB_ICON_SIZE` 26, `TAB_LABEL_GAP` 4, `TAB_INDICATOR` 3×24pt fully rounded. Inactive labels regular, active semibold.)
- 2026-10-07: `tabBarTotalHeight(inset)` = `TAB_BAR_HEIGHT` + bottom padding is the bar's real height. `tabBarClearance` stays 0: the custom bar takes layout space, so tab pages (Pit chat input, undo toast, scroll content) already end at its top edge; adding the bar height there would leave a gap of the bar's height.
- 2026-10-07: Android adaptive icon is a 1024×1024 transparent foreground keyed out of `assets/icon.png` (logo inside the 66dp safe circle), on `backgroundColor` = `bg`; no background image. Monochrome is the same silhouette in white. Regenerate both from icon.png if the logo changes.
