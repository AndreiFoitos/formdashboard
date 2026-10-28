# Home screen widgets (design)

Status: decided 2026-10-28, not built. **Phase 1 (read-only iOS widgets)
ships in the v1 App Store build. Phases 2–4 come after the v1 submission.**

Goal: show today's calories, protein, water, caffeine, training, the Pit Crew
plan and the friends race outside the app, and allow one-tap logging of water
and coffee.

## 0. Decisions

| Question | Decision |
|---|---|
| Lock-screen privacy | Numbers show by default. A Settings toggle hides them while the phone is locked. |
| Plans | **All widgets free on every plan.** This matches the monetization policy: never charge for logging, streaks or the caffeine curve. |
| Live Activities / Dynamic Island | **Dropped.** No live workout mode, and sets stay logged after the fact. |
| Small | Calorie ring + protein and water bars |
| Medium | Small layout + "+ water" and "+ coffee" buttons |
| Large / iPad XL | Medium + caffeine curve + Pit Crew today + friends race |
| Lock screen | Calories everywhere (circular metric configurable) |
| Actions | Log water, Log coffee (no app open); Scan meal, Scan barcode (open the app) |

## 1. Data sources

No new read endpoints. The widget data comes from three queries the app
already makes:

| Snapshot section | Endpoint | React Query key | Fields used |
|---|---|---|---|
| `today` | `GET /dashboard` | `['dashboard']` | `date`, `summary.calories_eaten`, `summary.protein_g`, `summary.water_ml`, `summary.caffeine_mg`, `summary.trained`, `targets.*`, `caffeine.curve`, `caffeine.current_mg`, `caffeine.caffeine_at_bedtime`, `caffeine.sleep_impact_level`, `caffeine.bedtime_hour` |
| `plan` | `GET /plan-ai/today` | `['plan-ai', 'today', planId]` | `workout.name`, `rest_day`, `next_workout.name`, `meals[]` (`name`, `slot`, `totals.calories`, `logged`) |
| `race` | `GET /friends/leaderboard` (raw sort, current week) | `['friends-leaderboard', null]` | `rows[]` (`is_me`, `total_volume_kg`, `user`), in server order |

## 2. Core design: the widget never calls the API to read

iOS widgets run in a separate process. If the widget fetched data itself, it
would need the refresh token, and `api/client.ts` rotates that token on every
refresh, so the app and the widget would keep invalidating each other's
tokens. Instead, the app writes a snapshot and widgets only read it.

### 2.1 `useWidgetSync` (mounted once in `app/_layout.tsx` when logged in)

1. **Cache listener.** `queryClient.getQueryCache().subscribe(...)`. On a
   successful update of any of the three keys in §1, rebuild that section
   of the snapshot, write it, then call `reloadWidgets()`. No changes to
   logging screens: every mutation already invalidates `['dashboard']`.
2. **Foreground prefetch.** On `AppState` → `active` (and right after
   login), `prefetchQuery` the leaderboard and Pit Crew today
   (`staleTime` 5 min). Without this, the race and plan sections would only
   refresh when the user visits Training or Pit Crew.
3. **Logout.** Clears the snapshot and the widget token, then calls
   `reloadWidgets()`. Called from the existing `clearAuth()` paths.
4. **Debounce.** Writes are coalesced (500 ms) so one log doesn't reload the
   widgets three times.

### 2.2 Snapshot (App Group `UserDefaults`, key `widget.snapshot.v1`)

```json
{
  "v": 1,
  "updatedAt": "2026-10-28T14:02:00Z",
  "units": "metric",
  "hideOnLockScreen": false,
  "quickLog": { "waterMl": 250, "drink": "coffee", "drinkLabel": "Coffee" },
  "today": {
    "date": "2026-10-28",
    "calories": 1640, "calorieTarget": 2400,
    "proteinG": 120, "proteinTargetG": 160,
    "waterMl": 1500, "waterTargetMl": 3000,
    "caffeineMg": 190, "trained": true
  },
  "caffeine": {
    "currentMg": 95, "atBedtimeMg": 40, "bedtimeHour": 23,
    "impactLevel": "mild",
    "curve": [{ "time": "2026-10-28T06:00:00Z", "mg": 0 }]
  },
  "plan": {
    "workoutName": "Push day", "restDay": false, "nextWorkoutName": null,
    "nextMeal": { "slot": "dinner", "name": "Salmon bowl", "kcal": 640 },
    "mealsLeft": 2
  },
  "race": { "rank": 2, "of": 6, "myKg": 18450, "gapKg": 1320, "aheadName": "Alex" }
}
```

Rules:
- `plan` is `null` when the user has no ready plan. `race` is `null` with no
  accepted friends. Widgets hide those blocks; they never show an empty box.
- `nextMeal` is the first meal with `logged == false`, in slot order.
- `race.gapKg` / `aheadName` are `null` when the user is first.
- Missing targets (`null` in the API) fall back to the app's defaults
  (water 2500 ml, the same fallback as `index.tsx`). The calorie ring shows
  just the number with no ring if there's no calorie target.
- The Swift side ignores unknown keys and treats a missing or older `v` as
  "no data" (§3.6), so old snapshots never crash the widget.

### 2.3 Day rollover and staleness

- The timeline always includes an entry at the next local midnight. If
  `today.date` ≠ the device's local date, every metric shows 0 / target, and
  `plan` and `caffeine` are hidden until the app writes again.
- The widget is only as fresh as the app's last fetch. Food logged on another
  device shows after the next app open. This is accepted.

## 3. Layouts

Colors come from `theme/tokens.ts` (DESIGN.md §2), copied into a Swift
`Tokens.swift`. Before building, add a short §"Widgets" to DESIGN.md with the
mapping below. That's required because DESIGN.md is binding.

| Element | Token |
|---|---|
| Background | `surface` (#18181b) |
| Calorie ring / bar | `accent` (progress) |
| Protein bar | `data.protein` |
| Water bar | `data.water` |
| Caffeine curve | stroke `text-muted`; current-level dot uses the app's impact colors (`success` / `warning` / `danger`, same as `CaffeineCurve.tsx`) |
| Goal hit (≥ 100%) | `success` |
| Primary text | `text`; secondary `text-muted`; captions `text-subtle` |
| Buttons | `surface-raised` fill, `text` label |

Fonts: system font (SF Pro), sizes picked from the DESIGN.md §3 scale. No
custom fonts in the extension.

**Rendering modes.** Every family must work in full color, tinted (iOS 18)
and clear/accented (iOS 26). In tinted/accented modes, rings and bars use
`.widgetAccentable()`, and the background is removed with
`containerBackground(for: .widget)`. Check each mode on a device before
shipping.

### 3.1 Small (`systemSmall`, also StandBy)

```
┌───────────────┐
│ ◔ 1,640 kcal  │   ring: calories / target (accent)
│   760 left    │   "760 left" or "120 over" (warning)
│               │
│ P ▓▓▓▓▓░░ 120g│   protein bar (data.protein)
│ W ▓▓▓░░░░ 1.5L│   water bar (data.water), unit from `units`
└───────────────┘
```
Tap → `gainrace://nutrition`.

### 3.2 Medium (`systemMedium`)

```
┌─────────────────────────────────┐
│ ◔ 1,640 kcal    │ [ + 250 ml ]  │
│   760 left      │               │
│ P ▓▓▓▓▓░░ 120g  │ [ + Coffee ]  │
│ W ▓▓▓░░░░ 1.5L  │ 95 mg · ✓ gym │
└─────────────────────────────────┘
```
- The left half is the Small layout. Tapping it opens `gainrace://nutrition`.
- Buttons are App Intents (§4). Until phase 3 ships, they're replaced by a
  caffeine line ("95 mg now") and the trained line ("✓ Trained" / "Rest day"),
  so the layout is useful on day one.
- Button labels come from `quickLog`: "+ 250 ml" / "+ 8 oz", "+ Coffee" /
  "+ Espresso".
- Each button is a 44 pt hit target (DESIGN.md rule 4).

### 3.3 Large (`systemLarge`) and Extra Large (`systemExtraLarge`, iPad)

```
┌─────────────────────────────────┐
│  [ Medium content ]             │
├─────────────────────────────────┤
│ Caffeine  95 mg now             │
│  ╲___                           │   curve, past solid / future dashed
│      ╲____  40 mg at bedtime    │
├─────────────────────────────────┤
│ Today · Push day                │   or "Rest day · next: Pull"
│ Next: dinner · Salmon · 640 kcal│   "All meals logged ✓" when done
├─────────────────────────────────┤
│ Race  #2 of 6 · 1,320 kg behind │   "#1 of 6 · leading" when first
│       Alex                      │
└─────────────────────────────────┘
```
- Each block hides when its data is `null` (no plan / no friends), and the
  others grow to fill the space.
- Block taps: caffeine → `gainrace://` (home), plan → `gainrace://ask`
  (the Pit Crew tab route), race → `gainrace://friends`.
- Extra Large: the same blocks in two columns (Medium + caffeine left, plan
  + race right).
- The caffeine curve is drawn from `caffeine.curve`. A timeline entry every
  15 min moves the "now" marker and recomputes `currentMg` by interpolating
  the curve, so no app update is needed through the day.
- Volume in the race uses `units` (kg / lb), same as the app.

### 3.4 Lock screen

| Family | Content |
|---|---|
| `accessoryCircular` | Ring with "760" inside (kcal left). **Configurable**: calories / water / protein / caffeine. |
| `accessoryRectangular` | Line 1 "1,640 / 2,400 kcal", line 2 "P 120g · W 1.5L" |
| `accessoryInline` | "760 kcal left" (or "120 kcal over") |

Tap → `gainrace://nutrition`.

### 3.5 Privacy ("Hide numbers on lock screen")

- New `SettingsGroup header="Widgets"` in `app/settings/index.tsx`, under
  Preferences. It holds this switch plus the two quick-log rows (§4.1).
  "Hide numbers on lock screen" is off by default. The app writes it to
  `hideOnLockScreen` in the snapshot.
- When on, all number text uses `.privacySensitive()`, so iOS redacts it on
  the locked lock screen and in StandBy while locked. Rings keep their shape
  but show no numbers.
- The setting is stored on the device only, not on the server.

### 3.6 Empty and logged-out states

- No snapshot / logged out: every family shows "Open GainRace to set up" and
  taps open the app.
- New day (§2.3): numbers at 0. No error state.

### 3.7 Widget configuration

One `AppIntentConfiguration` per family that has a choice:
- `accessoryCircular`: metric (calories, water, protein, caffeine).
- Home widgets aren't configurable in v1 (fixed layouts above).

## 4. Actions

### 4.1 The four actions

| Action | Surfaces | Behaviour |
|---|---|---|
| **Log water** | Medium/Large/XL button, Control Center, lock-screen control, Action Button | `POST /hydration/log` `{ amount_ml: quickLog.waterMl }` from the extension |
| **Log coffee** | Medium/Large/XL button, Control Center, lock-screen control, Action Button | `POST /stimulants/log` `{ substance: quickLog.drink }`. Server preset sets caffeine + macros, no add-ons. |
| **Scan meal** | Control Center, lock-screen control, Action Button | Opens `gainrace://nutrition-snap` |
| **Scan barcode** | Control Center, lock-screen control, Action Button | Opens `gainrace://nutrition-barcode` |

Quick-log settings, in the Settings "Widgets" group (§3.5), stored on the
device and in the snapshot:
- Water amount: one of the existing `WATER_PRESETS` (250 / 500 / 750 ml or
  8 / 16 / 24 oz), default 250 ml / 8 oz.
- Drink: any `SUBSTANCES` key from `backend/services/stimulants.py`, default
  `coffee` (95 mg).

After a successful log, the intent updates the snapshot locally and reloads
timelines:
- Water: `today.waterMl += amount`.
- Drink: `today.caffeineMg` and `caffeine.currentMg` go up by the preset's
  mg. The curve itself isn't recalculated in the widget; it updates on the
  next app open.

If the request fails (no network, revoked token), the button briefly shows "!"
and nothing changes. There's no offline queue in v1.

The intent reads the amounts from the `POST /stimulants/log` response
(`caffeine_mg`, `calories`, `protein_g`), so the widget never hard-codes the
`SUBSTANCES` table, and it adds `calories` / `protein_g` to the snapshot too.

Deep links: `nutrition-snap` and `nutrition-barcode` already exist as routes
(`app/nutrition-snap.tsx`, `app/nutrition-barcode.tsx`), so the `gainrace`
scheme opens them with no router work. Confirm that a cold start through the
link still runs the auth gate in `app/_layout.tsx` first.

### 4.2 Scoped widget token (the one backend change)

- `POST /auth/widget-token` (logged-in user). Returns
  `{ token, expires_at }`.
  - A JWT with claim `scope: "widget"` and `sub = user.id`, valid 90 days.
    The app re-requests it on every foreground once it is older than 30
    days.
  - A `widget_token_version` integer on `users`, put in the JWT and checked on
    use. Bumping it revokes every widget token for that user. It's bumped on
    logout, password change/reset, and account deletion (the deletion
    cascade handles the rest).
- Middleware: `get_current_user` **rejects** `scope: "widget"` tokens. A new
  `get_widget_user` dependency accepts **only** them, and only these routes
  use it:
  - `POST /hydration/log`
  - `POST /stimulants/log`

  Both endpoints get a thin second route
  (`/widget/hydration/log`, `/widget/stimulants/log`) that calls the same
  service code, so the normal routes keep their current dependency
  untouched.
- Rate limit: 30 requests / hour per user on the widget routes.
- Storage on the phone: shared **keychain access group**
  (`$(AppIdentifierPrefix)com.gainrace.app.shared`), never `UserDefaults`.
- Alembic migration: adds `users.widget_token_version INTEGER NOT NULL
  DEFAULT 0`.

### 4.3 Android

Same four actions. Android widget click handlers run in the app's own JS
runtime with SecureStore access, so they **use the normal tokens and
`api/client.ts`**. No widget token is needed.

## 5. Build setup

- No `ios/` / `android/` folders (Expo generates them at build time), so the
  widget target is added by a config plugin: **`@bacons/apple-targets`**.
  Swift sources go in `peakform-native/targets/widget/`.
  - Before installing, check the current version supports SDK 54
    (`npx expo install`, then `npx expo-doctor` must pass, as CLAUDE.md
    requires). Also check whether Expo's own `expo-widgets` has become
    stable for our SDK. If so, compare before choosing.
- **Entitlements, both targets:**
  - App Group `group.com.gainrace.app`
  - Keychain access group `com.gainrace.app.shared`
- Extension bundle ID `com.gainrace.app.widget`, deployment target iOS 17
  (interactive widgets). Control widgets are wrapped in
  `if #available(iOS 18, *)`.
- **Local Expo module** `modules/widget-bridge` (Swift + Kotlin stubs):
  - `setSnapshot(json: string)`
  - `clearSnapshot()`
  - `reloadWidgets()`
  - `setWidgetToken(token: string | null)`
- Swift files in the extension:
  - `Tokens.swift`
  - `Snapshot.swift` (Codable models)
  - `Provider.swift` (timeline: now, every 15 min until midnight, midnight)
  - `SmallView`, `MediumView`, `LargeView`, `ExtraLargeView`, `AccessoryViews`
  - `LogWaterIntent`, `LogDrinkIntent`
  - `OpenScanIntent`, `OpenBarcodeIntent`
  - `ControlWidgets.swift`
  - `WidgetBundle.swift`
- **Android:** `react-native-android-widget` (check SDK 54 support the same
  way). Widgets are registered in its config plugin. The Quick Settings tile
  goes in the same `modules/widget-bridge` module as a Kotlin `TileService`.
- Widget Swift/Kotlin can't be updated OTA. Every widget change needs a new
  binary.

## 6. Constraints

- **Windows, no Xcode.** No SwiftUI previews or local debugging. Every Swift
  iteration is an EAS build, then installing the dev client on a phone. Each
  build uses EAS free-plan iOS build quota (no-paid-hosting rule).
  Mitigation: write all views in one pass against the layouts above, add a
  debug-only "widget preview" screen in the app that renders the snapshot
  JSON, and batch Swift fixes per build.
- Phase 1 goes into the v1 build: run a full TestFlight pass of the whole
  app before submitting, since the build now has a second target. Phases
  2–4 wait until after the v1 submission.

## 7. Phases

Each phase ships on its own TestFlight build.

| # | Phase | Done when | Effort |
|---|---|---|---|
| 1 | Bridge + `useWidgetSync` + all read-only iOS widgets (Small, Medium with fallback right side, Large, XL, 3 lock-screen, configurable circular, privacy toggle, empty states, midnight rollover) + DESIGN.md §Widgets | Every family renders real data in all 3 rendering modes, updates within seconds of logging in the app, resets at midnight, clears on logout | ~3–4 days |
| 2 | Control Center / lock-screen / Action Button controls for Scan meal + Scan barcode | Each control opens the right screen from a cold start, after auth | ~1 day |
| 3 | Widget token (backend + migration + keychain) + Log water / Log coffee buttons and controls + quick-log settings | Tapping logs on the server without opening the app, the widget updates, the token stops working after logout | ~1.5 days |
| 4 | Android home widgets (Small/Medium/Large equivalents, resizable) + Quick Settings tile with the same actions | Same as phases 1–3 on an Android device | ~2–3 days |

## 8. Out of scope

- Live Activities / Dynamic Island (decided 2026-10-28: dropped).
- Apple Watch complications (needs a watchOS app).
- An offline queue for widget logs.
- Configurable home widgets.
