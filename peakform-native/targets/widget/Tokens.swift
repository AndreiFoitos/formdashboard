import SwiftUI

// Copied from theme/tokens.ts (DESIGN.md §2, §Widgets). SwiftUI can't read the
// TS file, so change both together. No other colors exist in the extension.

extension Color {
  init(hex: UInt32) {
    self.init(
      red: Double((hex >> 16) & 0xFF) / 255,
      green: Double((hex >> 8) & 0xFF) / 255,
      blue: Double(hex & 0xFF) / 255
    )
  }
}

enum Tokens {
  static let surface = Color(hex: 0x18181B)
  static let surfaceRaised = Color(hex: 0x27272A)
  static let divider = Color(hex: 0x27272A)
  static let text = Color(hex: 0xFAFAFA)
  static let textMuted = Color(hex: 0xA1A1AA)
  static let textSubtle = Color(hex: 0x71717A)
  static let accent = Color(hex: 0x2C66FB)
  static let success = Color(hex: 0x22C55E)
  static let warning = Color(hex: 0xF59E0B)
  static let danger = Color(hex: 0xEF4444)

  // data.* — charts only
  static let dataProtein = Color(hex: 0x818CF8)
  static let dataWater = Color(hex: 0x38BDF8)
}

// DESIGN.md §3 type scale (system font).
enum TypeScale {
  static let caption = Font.system(size: 12, weight: .medium)
  static let footnote = Font.system(size: 14)
  static let footnoteSemibold = Font.system(size: 14, weight: .semibold)
  static let body = Font.system(size: 16)
  static let headline = Font.system(size: 18, weight: .semibold)
  static let title = Font.system(size: 24, weight: .bold)
}

// DESIGN.md §4 spacing steps.
enum Space {
  static let s1: CGFloat = 4
  static let s2: CGFloat = 8
  static let s3: CGFloat = 12
  static let s4: CGFloat = 16
}
