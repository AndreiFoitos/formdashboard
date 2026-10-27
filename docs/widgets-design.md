# Home screen widgets (design)

Status: investigated 2026-10-28, not built. Planned for after the v1 App Store
submission (new target + signing is extra review risk).

Goal: every widget type, showing today's calories, protein, water, caffeine,
training and streak outside the app, plus one-tap logging where it makes sense.

## 1. Data

`GET /dashboard` (`backend/routers/dashboard.py`) already returns everything a
widget needs: `calories_eaten`, `protein_g`, `water_ml`, `caffeine_mg`,
`trained`, `form_score`, the caffeine curve and the targets. **No new read
endpoints.**

## 2. Core design: the widget never calls the API to read

iOS widgets run in a separate process. If the widget fetched `/dashboard`
itself it would need the refresh token, and `api/client.ts` rotates that token
on every refresh, so the app and widget would invalidate each other.

Instead:

1. **Snapshot.** Whenever the `['dashboard']` React Query cache entry updates,
   the app writes a small JSON snapshot to the App Group's shared
   `UserDefaults` and calls `WidgetCenter.reloadAllTimelines()`.
   One `queryCache.subscribe` listener covers every screen that refetches the
   dashboard (home, training, Pit Crew, notifications, `useUpdateMe`, ...).
   No changes needed to the logging screens.

   ```json
   { "date": "2026-10-28", "tz": "Europe/Bucharest",
     "calories": 1640, "calorieTarget": 2400,
     "protein": 120, "proteinTarget": 160,
     "waterMl": 1500, "waterTargetMl": 3000,
     "caffeine": { "...": "curve points for decay" },
     "trained": true, "formScore": 82, "streak": 5,
     "updatedAt": "2026-10-28T14:02:00Z" }
   ```

2. **Day rollover.** The widget's timeline includes an entry at local
   midnight. If `snapshot.date` isn't today, it shows 0 / target. Yesterday's
   numbers never show.
3. **Logout.** `clearAuth()` also clears the snapshot and reloads widgets.
4. **Limitation.** The widget is only as fresh as the app's last fetch. Food
   logged from another device shows after the next app open. That's
   acceptable for a calorie tracker.

## 3. Widget types

### Group 1: read-only (all from the snapshot, one widget extension)

| Type | Where | Content |
|---|---|---|
| `systemSmall` | Home screen, StandBy (automatic) | Calorie ring, eaten / target |
| `systemMedium` | Home screen | Calories, protein, water, trained today |
| `systemLarge` | Home screen | Above + form score + streak + caffeine curve |
| `systemExtraLarge` | iPad home screen only | Large layout, roomier |
| `accessoryCircular` | Lock screen | Calorie or water ring |
| `accessoryRectangular` | Lock screen | "1,640 / 2,400 kcal · 120g P" |
| `accessoryInline` | Line above the clock | "820 kcal left" |
| StandBy / Mac | Free (reuses Small; macOS shows iPhone widgets) | — |

Design notes:
- Must render correctly in **full color, tinted (iOS 18) and clear-glass
  (iOS 26)** modes. The app's dark-theme colors can't be used as-is.
- **Configurable metric.** A widget configuration intent lets the user pick
  calories / water / protein / caffeine per widget.
- **Caffeine** works well: the widget precomputes decay timeline entries
  (every 15 min) from the curve, e.g. "95 mg left · sleep-ready 22:40", with
  no app update needed.
- Tapping a widget deep-links into the app (`gainrace://` scheme), e.g. the
  calorie widget opens Nutrition.
- **Privacy.** Lock-screen widgets show health numbers to anyone holding the
  phone. Consider a "hide numbers on lock screen" option. The privacy
  manifest already declares Health/Fitness data.

### Group 2: tap to log

- **Interactive widgets (iOS 17+, App Intents):** "+250 ml water",
  "+1 coffee" buttons on the Small/Medium widgets.
- **Control Center controls (iOS 18+, `ControlWidget`):** "Log water",
  "Scan meal". The same controls work on the lock screen's bottom buttons and
  the Action Button.

Writing data from the widget process brings back the token problem. Plan:

| Action | Approach |
|---|---|
| Scan meal, barcode, open Pit Crew | Intent **opens the app** to that screen. No backend work. |
| Log water / caffeine | **Scoped widget token** (below), and the intent calls the API directly |

**Scoped widget token (the one backend change):**
- New endpoint, e.g. `POST /auth/widget-token`, called by the app after
  login. It returns a long-lived token whose only allowed scopes are
  `hydration:log` and `caffeine:log`.
- Stored in a **shared keychain access group** (not UserDefaults).
- Revoked on logout, password change, and account deletion. Auth middleware
  rejects it on every other route.
- After a successful log, the intent updates the snapshot optimistically and
  reloads timelines. The app refetches on next open as usual.

### Group 3: Live Activities / Dynamic Island

These are best for an in-progress workout: current exercise, set 3/4, rest
countdown.

**Blocked on a new app feature.** The app has no live workout mode or rest
timer today. Sets are logged after the fact (`ExerciseLogSheet` only shows
`rest_seconds` as text). Build live workout mode first.

- A local rest countdown (`Text(timerInterval:)`) needs no server.
- Server-driven updates (e.g. a Pit Crew nudge) need direct APNs pushes with
  the `liveactivity` push type. The current Expo push setup can't send those.
  Skip this in the first version.

### Group 4: Android

- **Home widgets** (resizable) via `react-native-android-widget`, written in
  JS. Click handlers run in the app's own JS runtime with SecureStore access,
  so **logging works with the normal tokens, with no scoped token needed**.
  The snapshot isn't strictly required, but reuse it to avoid a fetch on
  every redraw.
- **Quick Settings tile** (Android's Control Center button, `TileService`):
  a small native Kotlin module.

### Out of scope

- **Apple Watch complications** need a full watchOS app. That's a separate
  project.

## 4. Build setup

- No `ios/` / `android/` folders (Expo generates them at build time), so the
  widget target is added through a config plugin:
  **`@bacons/apple-targets`**. Swift sources live in `targets/widget/`, and
  EAS builds them. (Check whether Expo's own `expo-widgets` is stable for our
  SDK by then; it isn't relied on here.)
- **App Group** `group.com.gainrace.app` on the app and the extension.
  **Keychain group** shared too (for the widget token).
- Extension bundle ID `com.gainrace.app.widget`. EAS creates the provisioning
  profiles.
- **JS → native bridge**: a small local Expo module (preferred) with
  `setSnapshot(json)`, `clearSnapshot()`, `reloadWidgets()`,
  `setWidgetToken()`, and ActivityKit start/update/end later.
- Widget Swift code can't be updated OTA. Every change needs a new binary.

## 5. Constraints

- **Windows, no Xcode.** No SwiftUI previews or local debugging. Every Swift
  iteration is an EAS build, then installing the dev client on a phone. Each
  build uses EAS free-plan iOS build quota (no-paid-hosting rule). Sketch
  every layout before building, and batch Swift changes per build.
- Do this after the v1 submission.

## 6. Phases and effort

| # | Phase | Effort |
|---|---|---|
| 1 | Snapshot bridge + all read-only iOS widgets (incl. iPad, lock screen, configurable metric, caffeine decay) | ~3–4 days |
| 2 | Control Center controls + buttons that open the app | ~1 day |
| 3 | Scoped widget token (backend + keychain) + interactive water/caffeine buttons | ~1.5 days |
| 4 | Android home widgets + Quick Settings tile | ~2–3 days |
| 5 | Live workout mode in the app, then a Live Activity on top | ~3+ days |

## 7. Open questions

- Hide numbers on the lock screen by default, or make it opt-in?
- Gate any widget types behind Plus/Pro, or keep all widgets free?
- Live workout mode: is it a feature in its own right? If not, drop Phase 5.
