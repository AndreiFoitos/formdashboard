// Home screen + lock-screen widgets (docs/widgets-design.md, DESIGN.md §Widgets).
// Linked into the Xcode project at prebuild by @bacons/apple-targets.

/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'widget',
  name: 'GainRaceWidget',
  displayName: 'GainRace',
  // → com.gainrace.app.widget
  bundleIdentifier: '.widget',
  // Interactive widgets (phase 3 buttons) need iOS 17.
  deploymentTarget: '17.0',
  colors: {
    // accent and surface from theme/tokens.ts
    $accent: '#2c66fb',
    $widgetBackground: '#18181b',
  },
  entitlements: {
    // Same App Group as the app: the snapshot lives in its UserDefaults.
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
    // Shared keychain group for the phase 3 widget token. Added now so phase 3
    // needs no signing change.
    'keychain-access-groups': ['$(AppIdentifierPrefix)com.gainrace.app.shared'],
    // iOS only hides lock-screen widget content while locked when the extension
    // has Data Protection; without it .privacySensitive() is ignored unless the
    // user turned off "Lock Screen Widgets" in Face ID & Passcode. The views
    // opt back in with .unredacted() when "Hide numbers" is off.
    'com.apple.developer.default-data-protection': 'NSFileProtectionComplete',
  },
})
