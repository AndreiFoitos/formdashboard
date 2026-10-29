# Widgets phase 1: report

Branch `feat/widgets-phase1` (10 commits on top of `main`, not pushed). Spec:
`docs/widgets-design.md`. Date: 2026-10-28.

**Headline:** all phase 1 code is written and committed, and the JS side is
type-checked and unit-checked. **No EAS build ran.** The first build stopped
before upload, because the new widget target needs a provisioning profile, and
EAS can only create one after an interactive Apple Developer login (see §5).
No build quota was used. So the Swift has **not been compiled yet**. Your
first build is also the first compile check.

## 1. Summary

§7 phase 1 "Done when" items:

| Item | Built | Verified on a device |
|---|---|---|
| Every family renders real data | ✓ Small, Medium, Large, XL, circular, rectangular, inline | ✗ (no build yet) |
| … in all 3 rendering modes | ✓ rings, bars and the curve dot are `.widgetAccentable()`, background is `containerBackground` | ✗ |
| Updates within seconds of logging in the app | ✓ cache listener → 500 ms debounce → write + `reloadAllTimelines()` | ✗ (JS logic unit-checked in Node) |
| Resets at midnight | ✓ timeline entry at local midnight; a later day shows 0 / target and hides plan + caffeine | ✗ |
| Clears on logout | ✓ every `clearAuth()` path, plus a cold start with no saved session | ✗ (JS logic unit-checked in Node) |
| DESIGN.md §Widgets | ✓ | n/a |
| Privacy toggle | ✓ Settings → Widgets → "Hide numbers on lock screen" → `.privacySensitive()` | ✗ |
| Empty states | ✓ missing, malformed or older snapshot → "Open GainRace to set up" | ✗ |
| Configurable circular | ✓ calories / water / protein / caffeine (`AppIntentConfiguration`) | ✗ |

Also done: the widget-bridge module, App Group and shared keychain group on
both targets, a dev-only snapshot screen, and privacy manifests.

What I checked without a Mac:
- `npx tsc --noEmit`: clean. `npx expo-doctor`: 18/18 after every dependency change.
- A local **iOS prebuild** on Windows (see Decisions). It produces the
  `GainRaceWidget` target with bundle ID `com.gainrace.app.widget`, iOS 17.0,
  Swift 5 language mode and both entitlement groups. It is embedded in the
  app, and every Swift file plus `PrivacyInfo.xcprivacy` is in the target.
  This caught two problems that would each have failed an EAS build (see
  Deviations 1 and 2).
- `npx expo-modules-autolinking resolve`: `WidgetBridge` is linked, and
  apple-targets' iOS 16.4 pod is excluded.
- A Node test of the snapshot builders, the debounce and "no write after
  logout": passes.

## 2. Files

Added:
- `peakform-native/targets/widget/expo-target.config.js`: widget target config (bundle ID, iOS 17, App Group, keychain group, accent/background colors).
- `peakform-native/targets/widget/Info.plist`: WidgetKit extension point.
- `peakform-native/targets/widget/PrivacyInfo.xcprivacy`: the extension's privacy manifest (App Group UserDefaults, `1C8F.1`).
- `peakform-native/targets/widget/Tokens.swift`: colors, type scale and spacing copied from `theme/tokens.ts`.
- `peakform-native/targets/widget/Snapshot.swift`: lenient Codable snapshot, App Group loader, per-moment `DayData` (rollover, caffeine interpolation) and number formatting.
- `peakform-native/targets/widget/Provider.swift`: timeline (now, every 15 min, midnight), static and AppIntent providers, the `LockMetric` intent, and sample data for the gallery.
- `peakform-native/targets/widget/Components.swift`: ring, bars, nutrition summary, the Medium status column, caffeine curve, plan/race blocks and the empty state.
- `peakform-native/targets/widget/HomeViews.swift`: Small, Medium, Large and Extra Large layouts with per-block deep links.
- `peakform-native/targets/widget/AccessoryViews.swift`: rectangular, inline and the configurable circular widget.
- `peakform-native/targets/widget/WidgetBundle.swift`: `@main` bundle with 3 widgets: Today (home), Calories (rect/inline) and Ring (circular).
- `peakform-native/modules/widget-bridge/index.ts`: JS API (`setSnapshot`, `getSnapshot`, `clearSnapshot`, `reloadWidgets`, `setWidgetToken` stub). Every call is a safe no-op without the native module.
- `peakform-native/modules/widget-bridge/ios/WidgetBridgeModule.swift`: App Group `UserDefaults` read/write + `WidgetCenter` reload. `setWidgetToken` is a phase 3 no-op.
- `peakform-native/modules/widget-bridge/ios/WidgetBridge.podspec`: pod for the module (iOS 15.1, same as the app).
- `peakform-native/modules/widget-bridge/android/…`: Kotlin no-op stub + `build.gradle`.
- `peakform-native/modules/widget-bridge/expo-module.config.json`, `package.json`: module registration.
- `peakform-native/lib/widgets.ts`: snapshot format + builders, debounced writer, logout/account-switch clearing, and the device-only "hide numbers" preference.
- `peakform-native/hooks/useWidgetSync.ts`: cache listener, seeding from the cache, foreground prefetch, and clearing on a signed-out cold start.
- `peakform-native/app/widget-debug.tsx`: `__DEV__`-only screen showing the stored and next snapshot JSON.
- `docs/widgets-phase1-report.md`: this report.

Changed:
- `peakform-native/app.json`: `ios.entitlements` (App Group, keychain groups), the `@bacons/apple-targets` plugin, `1C8F.1` added to the UserDefaults privacy reasons.
- `peakform-native/package.json` / `package-lock.json`: `@bacons/apple-targets` 5.0.0, `expo-asset` ~12.0.14, `expo.autolinking.exclude`.
- `peakform-native/app/_layout.tsx`: mounts `useWidgetSync()` in AuthGate and registers the `widget-debug` route.
- `peakform-native/app/settings/index.tsx`: "Widgets" group (iOS only) and a Developer row for the snapshot screen.
- `peakform-native/DESIGN.md`: new §Widgets with the token mapping and rules.
- `peakform-native/.gitignore`: ignores the colorsets and entitlements apple-targets generates at prebuild.

## 3. Deviations from the spec

1. **`@bacons/apple-targets` 5.0.0, not 4.x.** I installed 4.0.7 first, but its
   prebuild crashed: it needs `@expo/prebuild-config` at the top of
   node_modules, and SDK 54 only nests it inside `@expo/cli`. Installing
   `@expo/prebuild-config` directly fails expo-doctor. 5.0.0 declares it as a
   dependency (v55, used only by the plugin's asset helpers). The SDK 54 CLI
   keeps its own nested v54 copy, and expo-doctor passes. `expo-widgets` was
   ruled out because its first release is for SDK 55; there is no SDK 54 version.
2. **apple-targets' native pod is excluded from autolinking**
   (`expo.autolinking.exclude`). Its `ExtensionStorage` pod requires iOS
   16.4, the app targets 15.1, and pod install would fail. We only use the
   config plugin.
3. **Snapshot has one extra field, `plan.mealsPlanned`.** Without it,
   `nextMeal: null, mealsLeft: 0` can't tell "all meals logged" apart from
   "this plan has no meal plan". The widget hides the meal line when it's 0.
4. **The hook also listens to `['plan-ai', 'plan']`**, on top of the three
   keys in §1. When there's no ready plan, the today query never runs, so
   this is how `plan` becomes `null`.
5. **The foreground prefetch also covers `['dashboard']`** (60 s stale), so
   opening the app after midnight writes the new day even if the Today tab
   doesn't refetch on its own.
6. **Logout clearing is one subscription to the auth store** in
   `lib/widgets.ts`, not a call added at each `clearAuth()` site. It catches
   every path: sign out, delete account, onboarding sign out and failed token
   refresh. It also fires on an account switch. The store stays free of
   native imports.
7. **Keychain groups on the app list the app's own group first**
   (`$(AppIdentifierPrefix)com.gainrace.app`, then `…com.gainrace.app.shared`).
   iOS writes new keychain items to the first group listed. With the shared
   group first, SecureStore would put the refresh token where the widget can
   read it. With this order, SecureStore's behaviour is unchanged.
8. **Medium right side:** "95 mg / Caffeine now", then one training line:
   "Trained" (✓, success), "Rest day", today's workout name, or "Not trained
   yet". The spec only named "✓ Trained" / "Rest day".
9. **Water on widgets is "oz", not "fl oz"**, to fit the Small bar label. The
   app keeps "fl oz".
10. **Settings "Widgets" group is iOS only.** Android has no widgets until
    phase 4.

## 4. Decisions I made alone

- **Three widgets in the gallery:** "Today" (all home sizes), "Calories"
  (rectangular + inline) and "Ring" (circular, configurable). The circular
  needs its own `AppIntentConfiguration`, so it can't share a widget with
  the static families.
- **Local iOS prebuild on Windows.** `expo prebuild` skips iOS on Windows, so
  a scratch script calls the CLI's prebuild with only the platform guard
  bypassed, then I inspect and delete `ios/`. Nothing generated was
  committed.
- **No `ios.appleTeamId`.** apple-targets warns about it, but EAS sets the team
  per target from the provisioning profiles. I couldn't find your team ID
  without your Apple login.
- **The widget extension gets its own `PrivacyInfo.xcprivacy`**, and `1C8F.1`
  (App Group UserDefaults) was added to the app's manifest.
- **The race block hides at the first midnight of a new week (Monday).** The
  snapshot's weekly race would be last week's until the app is opened.
- **Circular caffeine ring is full at 400 mg** (common adult daily guidance).
  The app has no single ceiling for this.
- **Calorie ring:** `success` once ≥ 100% of target, "120 over" in `warning`.
  The ring shows a small "kcal" label inside. With no calorie target there is
  no ring, just the number.
- **Clearing on a signed-out cold start happens only when no refresh token is
  saved.** An offline start, where the token exists but the refresh failed,
  keeps the last snapshot instead of blanking the widget.
- **`quickLog` is written with fixed defaults** (250 ml or 237 ml / 8 oz,
  coffee), so the snapshot matches the v1 format and phase 3 only has to make
  it configurable.
- **Curve times are normalised to UTC ISO without milliseconds**, the plain
  form Swift's `ISO8601DateFormatter` accepts. The Swift side accepts both
  forms anyway.
- **Gallery previews show sample numbers** (1,640 kcal, Push day, #2 of 6)
  when there's no snapshot yet. The placed widget shows the setup message.
- **Bumped `expo-asset` 12.0.13 → 12.0.14** (patch). expo-doctor was already
  failing on `main` because of it.

## 5. Builds

| # | Command | Result | URL |
|---|---|---|---|
| — | `eas build --profile development --platform ios --non-interactive --no-wait` (me) | Stopped before upload: "EAS CLI couldn't find any credentials suitable for internal distribution. Run this command again in interactive mode." **No build was created** and no quota was used. | none |
| 1 | `eas build --profile development --platform ios` (you, interactive) | ✓ Compiled and signed: the widget Swift built on the first try. Couldn't be opened, because the dev client couldn't reach Metro on that network. | https://expo.dev/accounts/asky12346272/projects/gainrace-native/builds/e8bbbff3-66f3-406d-8fc3-34f3a5d20eb2 |
| 2 | `eas build --profile production --platform ios --auto-submit` (you, build 20) | ✓ On TestFlight; first device test, see §10. | (not recorded) |

**The next build needs the interactive login once more.** The round 2 fix adds
Data Protection to the widget extension, which is a new App ID capability. Let
EAS sync capabilities and regenerate the widget's provisioning profile when it
asks.

Why: the widget is a second target (`com.gainrace.app.widget`) that needs its
own App ID and ad hoc provisioning profile. The app's profile also has to be
regenerated, because the App Groups capability is new. EAS can only do that
after an Apple Developer login, which I can't do for you.

**What to run (interactive, in your own terminal), from `peakform-native/`:**

```bash
eas build --profile development --platform ios
```

Log in to Apple when asked and let EAS generate new profiles. That creates
the widget App ID, enables App Groups, registers `group.com.gainrace.app` and
signs both targets. This is build 1. If it fails to compile, send me the
Xcode log section and I'll batch the fixes for the spare build. The
production profile will need the same one-time interactive step the next
time you run a production build.

## 6. Test checklist

Setup: install the dev build on an iPhone (iOS 17+) and an iPad, run
`npx expo start`, and sign in to an account that has food, water, caffeine
and training logged today, a ready Pit Crew plan, and at least one friend.

**Data check without widgets**
1. Settings → Developer → Widget snapshot. Expected: "Stored" shows JSON with
   `v: 1`, today's date, your numbers, and `plan` / `race` filled in.
   "Native module not in this build" means you are on an older binary.

**Home screen (iPhone)**
2. Add "Today" Small. Expected: calorie ring with "kcal" inside, the number,
   "N left" (or "N over" in orange), and P/W bars. Tap → Nutrition tab.
3. Add Medium. Expected: the left half as in step 2; the right side shows
   "N mg / Caffeine now" and "Trained" ✓ (or Rest day / workout name / Not
   trained yet). Left tap → Nutrition, right tap → Today.
4. Add Large. Expected: Medium on top, then the caffeine curve (past solid,
   future dashed, a colored dot at now, "N mg now · N mg at bedtime"), Pit
   Crew today ("Today · Push day" + "Next: dinner · … · 640 kcal"), then the
   race ("#2 of 6 · 1,320 kg behind" + "Behind Alex"). Taps: curve → Today,
   plan → Pit tab, race → Friends.
5. Long-press → Edit Home Screen → Customize → **Tinted** (iOS 18). Expected:
   no dark background, and rings, bars and the dot in the tint color with
   readable text. Then try **Clear** (iOS 26) and **Dark**.
6. StandBy (charging, landscape, locked): the Small widget shows.

**iPad**
7. Add "Today" **Extra Large**. Expected: Medium + caffeine on the left, plan +
   race on the right. Also check Small/Medium/Large on iPad.

**Updates from the app**
8. With Small + Large on the home screen, log water in the app, then go home.
   Expected: the W bar and number update within a few seconds.
9. Log a coffee. Expected: Medium "mg" and the Large curve and dot update.
10. Log a meal (snap or barcode). Expected: calories and "left" update; on
    Large, if it was a plan meal, "Next:" moves to the next meal, then "All
    meals logged" ✓ after the last one.

**Lock screen**
11. Add "Calories" rectangular: "1,640 / 2,400 kcal", "P 120 g · W 1.5 L" and
    a thin progress bar. Inline: "760 kcal left". Taps → Nutrition.
12. Add "Ring" circular, then long-press → edit → "Shows": try Calories (kcal
    left), Water (L), Protein (g) and Caffeine (mg). Each should show the right
    number.
13. Privacy: Settings → Widgets → turn on "Hide numbers on lock screen". Lock
    the phone and wake the screen without unlocking. Expected: numbers are
    redacted and rings keep their shape. Unlock → numbers show. Turn it off →
    numbers show while locked.

**Edge cases**
14. Midnight: leave the phone past local midnight without opening the app.
    Expected: all numbers 0 / target, Large hides the caffeine and plan
    blocks, and the race stays (on a Sunday night it hides too). Open the app:
    the new day's data appears.
15. User with no Pit Crew plan: Large shows no plan block, and the other blocks
    fill the space. Medium's training line falls back to Trained / Not
    trained yet.
16. User with no friends: Large and XL show no race block.
17. Imperial: Settings → Units → Imperial. Expected: water in oz on all
    widgets, race gap in lb, the circular water ring in oz.
18. Logout: Settings → Sign out. Expected: every widget switches to "Open
    GainRace to set up" within seconds. Tap → opens the app (login). Sign in
    as a **different** user: widgets show only that user's data.
19. Delete account (on a throwaway account): widgets clear as in step 18.
20. Fresh install, never logged in: widgets show the setup message, and the
    gallery shows sample numbers.

## 7. Submission impact

- **app.json changed:** new `ios.entitlements` (App Group
  `group.com.gainrace.app`; keychain groups `…com.gainrace.app` and
  `…com.gainrace.app.shared`), the `@bacons/apple-targets` plugin, and
  `1C8F.1` added to the UserDefaults reasons in `privacyManifests`. No new
  collected data types, so the App Privacy answers in App Store Connect don't
  change.
- **New app extension:** `GainRaceWidget.appex` with its own
  `PrivacyInfo.xcprivacy`. The build now has two bundle IDs and two
  provisioning profiles (§5). Add the widget App ID to the production
  credentials before the submission build.
- **Reviewer view:** the widgets show "Open GainRace to set up" until the
  reviewer logs in and opens the app once. Consider a line in the review
  notes: "Home screen and lock-screen widgets show the demo account's day
  after the app has been opened once." The widgets make no network calls.
- **Screenshots:** widgets are optional in screenshots. The listing doesn't
  have to mention them.
- **No backend change** and nothing in `backend/` was touched.
- As §6 of the spec says: run a full TestFlight pass of the whole app before
  submitting, since the build now has a second target.

## 8. Known issues and risks

- **The Swift is uncompiled.** I reviewed it by hand against iOS 17 APIs and
  avoided anything newer. Rendering-mode APIs are iOS 16/17, and nothing
  needed `#available`. Still, a typo-level compile error on the first build is
  possible.
- **Layout is untested on a device.** In particular: the Large height budget
  with all four blocks on smaller iPhones, the rectangular lock widget with
  three lines, and how the 15-min timeline feels through the day.
- **Freshness depends on the app.** A widget is only as fresh as the last time
  the app fetched (spec §2.3). Logs from another device appear after the next
  app open.
- **Day boundary uses the device time zone.** The server uses `users.timezone`.
  If the two differ (travel), the midnight reset follows the phone.
- **@bacons/apple-targets 5.0.0 is used on SDK 54 against its intended SDK
  55 helpers.** Prebuild works locally; EAS hasn't run it yet.
- **The build carries an inert `ActivityKit` framework link**, from
  apple-targets' default widget frameworks. It's harmless; no Live Activities
  are declared.
- **Phase 3 keychain group is unused for now.** It's already in both
  entitlements, so the signing setup won't change when phase 3 ships.

## 9. Unrelated issues spotted (not fixed)

- `eas-cli` on this machine is 24.11.0; 26.0.0 is available.
- The root `.gitignore` ignores every `build/` folder in the repo. A future
  native module or package with a `build/` folder would silently go
  unversioned.
- `app/_layout.tsx` hydrate: if the refresh call fails for a network reason
  (backend asleep, offline), the user stays logged out for that session even
  though the refresh token is still valid.
- `app/_layout.tsx` Sentry comment mentions Railway; the backend is on Render.
- `npm audit` reports existing advisories in the dependency tree (not reviewed).

## 10. Round 2: fixes from the first TestFlight pass (2026-10-29)

| Report | Cause | Fix |
|---|---|---|
| "Hide numbers on lock screen" did nothing | iOS shows lock-screen widget content while locked unless the user turns off Face ID & Passcode → Lock Screen Widgets. `.privacySensitive()` alone only works with that off. | The extension now has Data Protection (`NSFileProtectionComplete`), so iOS redacts it while locked. Views opt back in with `.unredacted()` while the switch is **off**, so numbers still show by default (§0). With the switch on, all text is hidden while locked; rings keep their shape. |
| Tinted / clear looked off | Outside full color iOS keeps only opacity. The opaque gray ring/bar tracks rendered solid white, so every ring and bar looked full (e.g. 2 g of protein). | Grays come from `ink()`: tokens in full color, white at 100/70/50/20% otherwise. Recorded in DESIGN.md §Widgets. |
| Small ring too small and ugly | 48 pt ring with a "kcal" label. | 64 pt ring, 7 pt stroke, kcal left (or "over" in `warning`) inside; eaten and "of N kcal" beside it. Also used in Medium / Large / XL. |
| Lock-screen circle showed "2.7..." | 4-digit numbers don't fit. | Compact numbers: "2.8k". |
| Large / Medium showed sample data (1,640, Salmon bowl, #2 of 6) | That's the placeholder: iOS hadn't rendered our timeline. The likely cause is too many entries (every 15 min until midnight, ~55) for the larger sizes. | 15-min entries for the next 2 hours only, plus midnight when it falls inside; WidgetKit asks for a new timeline after that. Needs confirming on the device. |
| Signed out, tapping a widget opened Today | After sign out the tabs stay mounted under `/login`. A deep link back to them doesn't change auth state, so `useRequireAuth` didn't redirect again. | `useRequireAuth` also checks on focus. Expect a brief flash of the tab before the login screen. This also fixes the same path for notification and invite links. |

Retest on the next build: §6 steps 2–5, 11–13 and 18, plus the sizes in Tinted
and Clear. Remove and re-add the lock-screen widgets once, since iOS can keep
a stale copy.

Not changed: the dev client couldn't reach Metro because the PC and phone were
on a network that blocks device-to-device traffic. That's a network issue,
not the app.
