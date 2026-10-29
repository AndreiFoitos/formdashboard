import SwiftUI
import WidgetKit

// Shared pieces for every family. Rings, bars and the curve are
// .widgetAccentable() so tinted (iOS 18) and clear (iOS 26) modes color them
// as the accent group; text stays in the default group.

enum Links {
  static let home = URL(string: "gainrace://")!
  static let nutrition = URL(string: "gainrace://nutrition")!
  static let pit = URL(string: "gainrace://ask")!
  static let friends = URL(string: "gainrace://friends")!
}

extension View {
  /// Number text: redacted on the locked lock screen / StandBy when
  /// "Hide numbers on lock screen" is on.
  func numberText(_ data: DayData) -> some View {
    self.monospacedDigit().privacySensitive(data.hideNumbers)
  }

  /// The extension has Data Protection (complete), so iOS redacts the whole
  /// widget while the phone is locked. With "Hide numbers" off we opt back in,
  /// so numbers show on the lock screen by default (docs/widgets-design.md §0).
  @ViewBuilder
  func lockScreenPrivacy(hide: Bool) -> some View {
    if hide {
      self
    } else {
      self.unredacted()
    }
  }

  /// Text and chrome grays that survive tinted / clear / lock-screen rendering.
  func ink(_ ink: Ink) -> some View {
    modifier(InkModifier(ink: ink))
  }
}

enum Ink {
  case text, muted, subtle, track, divider
}

/// In full color these are the DESIGN.md tokens. In the other rendering modes
/// iOS drops the hue and keeps only opacity, so opaque grays would all turn
/// solid white (a track would look like a full ring); there the hierarchy is
/// carried by opacity instead.
private struct InkModifier: ViewModifier {
  @Environment(\.widgetRenderingMode) private var mode
  let ink: Ink

  func body(content: Content) -> some View {
    content.foregroundStyle(color)
  }

  private var color: Color {
    if mode == .fullColor {
      switch ink {
      case .text: return Tokens.text
      case .muted: return Tokens.textMuted
      case .subtle: return Tokens.textSubtle
      case .track: return Tokens.surfaceRaised
      case .divider: return Tokens.divider
      }
    }
    switch ink {
    case .text: return Color.white
    case .muted: return Color.white.opacity(0.7)
    case .subtle: return Color.white.opacity(0.5)
    case .track, .divider: return Color.white.opacity(0.2)
    }
  }
}

struct Ring: View {
  var progress: Double
  var color: Color
  var lineWidth: CGFloat = 5

  var body: some View {
    ZStack {
      Circle()
        .stroke(lineWidth: lineWidth)
        .ink(.track)
      Circle()
        .trim(from: 0, to: max(0.001, progress))
        .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
        .rotationEffect(.degrees(-90))
        .widgetAccentable()
    }
  }
}

struct Bar: View {
  var progress: Double
  var color: Color

  var body: some View {
    GeometryReader { geo in
      ZStack(alignment: .leading) {
        Capsule().ink(.track)
        Capsule()
          .fill(color)
          .frame(width: max(0, geo.size.width * progress))
          .widgetAccentable()
      }
    }
    .frame(height: 6)
  }
}

/// "P ▓▓▓▓░░ 120 g"
struct MetricBar: View {
  var label: String
  var value: Int
  var target: Int?
  var valueText: String
  var color: Color
  var data: DayData

  var body: some View {
    let hit = DayData.goalHit(value, target)
    HStack(spacing: Space.s2) {
      Text(label)
        .font(TypeScale.caption)
        .ink(.muted)
        .frame(width: 12, alignment: .leading)
      Bar(progress: DayData.progress(value, target), color: hit ? Tokens.success : color)
      Text(valueText)
        .font(TypeScale.caption)
        .ink(.text)
        .numberText(data)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .fixedSize(horizontal: true, vertical: false)
    }
  }
}

/// Calorie ring with kcal left inside, eaten / target beside it, then protein
/// and water bars. The Small widget, and the left half of Medium / Large / XL.
struct NutritionSummary: View {
  var data: DayData

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      HStack(spacing: Space.s3) {
        if let target = data.calorieTarget, let left = data.caloriesLeft {
          let hit = DayData.goalHit(data.calories, target)
          Ring(progress: DayData.progress(data.calories, target), color: hit ? Tokens.success : Tokens.accent, lineWidth: 7)
            .overlay {
              RingLabel(left: left, data: data)
                .padding(Space.s2)
            }
            .frame(width: 64, height: 64)
          VStack(alignment: .leading, spacing: 0) {
            Text(Format.number(data.calories))
              .font(TypeScale.headline)
              .ink(.text)
              .numberText(data)
              .lineLimit(1)
              .minimumScaleFactor(0.6)
            Text("of \(Format.number(target)) kcal")
              .font(TypeScale.caption)
              .ink(.subtle)
              .numberText(data)
              .lineLimit(1)
              .minimumScaleFactor(0.6)
          }
        } else {
          // No calorie target: just the number, no ring (§2.2).
          VStack(alignment: .leading, spacing: 0) {
            Text(Format.number(data.calories))
              .font(TypeScale.title)
              .ink(.text)
              .numberText(data)
              .lineLimit(1)
              .minimumScaleFactor(0.6)
            Text("kcal")
              .font(TypeScale.caption)
              .ink(.muted)
          }
        }
      }
      Spacer(minLength: 0)
      VStack(spacing: Space.s2) {
        MetricBar(
          label: "P", value: data.proteinG, target: data.proteinTargetG,
          valueText: "\(Format.number(data.proteinG)) g", color: Tokens.dataProtein, data: data
        )
        MetricBar(
          label: "W", value: data.waterMl, target: data.waterTargetMl,
          valueText: Format.water(data.waterMl, data.units), color: Tokens.dataWater, data: data
        )
      }
    }
  }

}

/// Inside the calorie ring: "760 / left" or "120 / over" (warning).
struct RingLabel: View {
  var left: Int
  var data: DayData

  var body: some View {
    VStack(spacing: 0) {
      Text(Format.number(abs(left)))
        .font(TypeScale.headline)
        .ink(.text)
        .numberText(data)
        .lineLimit(1)
        .minimumScaleFactor(0.5)
      if left >= 0 {
        Text("left")
          .font(TypeScale.caption)
          .ink(.muted)
      } else {
        Text("over")
          .font(TypeScale.caption)
          .foregroundStyle(Tokens.warning)
      }
    }
  }
}

/// Medium's right side in phase 1: caffeine now + trained / rest day.
/// (Phase 3 replaces it with the quick-log buttons.)
struct StatusColumn: View {
  var data: DayData

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      VStack(alignment: .leading, spacing: 0) {
        Text("\(Format.number(data.caffeine?.currentMg ?? data.caffeineMg)) mg")
          .font(TypeScale.headline)
          .ink(.text)
          .numberText(data)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        Text(data.caffeine != nil ? "Caffeine now" : "Caffeine today")
          .font(TypeScale.caption)
          .ink(.subtle)
      }
      Spacer(minLength: 0)
      TrainingLine(data: data)
    }
  }
}

struct TrainingLine: View {
  var data: DayData

  var body: some View {
    if data.trained {
      Label("Trained", systemImage: "checkmark.circle.fill")
        .font(TypeScale.footnoteSemibold)
        .foregroundStyle(Tokens.success)
        .lineLimit(1)
    } else if data.plan?.restDay == true {
      Text("Rest day")
        .font(TypeScale.footnote)
        .ink(.muted)
        .lineLimit(1)
    } else if let workout = data.plan?.workoutName {
      Text(workout)
        .font(TypeScale.footnote)
        .ink(.muted)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    } else {
      Text("Not trained yet")
        .font(TypeScale.footnote)
        .ink(.muted)
        .lineLimit(1)
    }
  }
}

/// Same thresholds as zoneColour() in components/CaffeineCurve.tsx.
func caffeineColor(_ mg: Int) -> Color {
  if mg < 50 { return Tokens.textSubtle }
  if mg < 200 { return Tokens.success }
  if mg < 300 { return Tokens.warning }
  return Tokens.danger
}

/// Past solid, future dashed, a dot at now.
struct CaffeineCurveShape: View {
  var caffeine: CaffeineData
  var now: Date

  var body: some View {
    GeometryReader { geo in
      if let chart = CurveGeometry(points: caffeine.points, size: geo.size, now: now) {
        ZStack(alignment: .topLeading) {
          chart.pastPath()
            .stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
            .ink(.muted)
          chart.futurePath()
            .stroke(style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: [3, 4]))
            .ink(.muted)
          Circle()
            .fill(caffeineColor(Int(chart.nowMg.rounded())))
            .frame(width: 8, height: 8)
            .position(chart.nowPoint)
            .widgetAccentable()
        }
      }
    }
  }
}

/// Maps curve points into a rect. nil when there's nothing to draw.
struct CurveGeometry {
  let points: [(date: Date, mg: Double)]
  let size: CGSize
  let first: Date
  let span: TimeInterval
  let peak: Double
  let clampedNow: Date
  let nowMg: Double

  init?(points: [(date: Date, mg: Double)], size: CGSize, now: Date) {
    guard points.count >= 2, let first = points.first?.date, let last = points.last?.date, last > first else {
      return nil
    }
    self.points = points
    self.size = size
    self.first = first
    self.span = last.timeIntervalSince(first)
    var top: Double = 100
    for p in points where p.mg > top {
      top = p.mg
    }
    self.peak = top
    let clamped = min(max(now, first), last)
    self.clampedNow = clamped
    self.nowMg = DayData.interpolate(points, at: clamped) ?? 0
  }

  func point(_ date: Date, _ mg: Double) -> CGPoint {
    let inset: CGFloat = 4
    let fx = date.timeIntervalSince(first) / span
    let fy = 1 - min(mg, peak) / peak
    let x = CGFloat(fx) * size.width
    let y = inset + CGFloat(fy) * (size.height - 2 * inset)
    return CGPoint(x: x, y: y)
  }

  var nowPoint: CGPoint {
    return point(clampedNow, nowMg)
  }

  func pastPath() -> Path {
    var path = Path()
    path.move(to: point(points[0].date, points[0].mg))
    for p in points where p.date < clampedNow {
      path.addLine(to: point(p.date, p.mg))
    }
    path.addLine(to: nowPoint)
    return path
  }

  func futurePath() -> Path {
    var path = Path()
    path.move(to: nowPoint)
    for p in points where p.date > clampedNow {
      path.addLine(to: point(p.date, p.mg))
    }
    return path
  }
}

struct CaffeineBlock: View {
  var caffeine: CaffeineData
  var data: DayData
  var now: Date

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s1) {
      HStack(alignment: .firstTextBaseline) {
        Text("Caffeine")
          .font(TypeScale.caption)
          .ink(.subtle)
        Spacer(minLength: Space.s2)
        Text("\(Format.number(caffeine.currentMg)) mg now")
          .font(TypeScale.footnoteSemibold)
          .ink(.text)
          .numberText(data)
        Text("· \(Format.number(caffeine.atBedtimeMg)) mg at bedtime")
          .font(TypeScale.caption)
          .ink(.muted)
          .numberText(data)
      }
      .lineLimit(1)
      .minimumScaleFactor(0.8)
      CaffeineCurveShape(caffeine: caffeine, now: now)
        .frame(minHeight: 32, maxHeight: .infinity)
    }
  }
}

struct PlanBlock: View {
  var plan: PlanData
  var data: DayData

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(headline)
        .font(TypeScale.footnoteSemibold)
        .ink(.text)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      if plan.mealsPlanned > 0 {
        if let meal = plan.nextMeal {
          Text("Next: \(meal.slot) · \(Format.capitalized(meal.name)) · \(Format.number(meal.kcal)) kcal")
            .font(TypeScale.caption)
            .ink(.muted)
            .numberText(data)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
        } else {
          Label("All meals logged", systemImage: "checkmark")
            .font(TypeScale.caption)
            .foregroundStyle(Tokens.success)
            .lineLimit(1)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var headline: String {
    if plan.restDay {
      if let next = plan.nextWorkoutName { return "Rest day · next: \(next)" }
      return "Rest day"
    }
    if let workout = plan.workoutName { return "Today · \(workout)" }
    return "Today · no workout planned"
  }
}

struct RaceBlock: View {
  var race: RaceData
  var data: DayData

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      HStack(spacing: Space.s1) {
        Text("Race")
          .font(TypeScale.caption)
          .ink(.subtle)
        Text(line)
          .font(TypeScale.footnoteSemibold)
          .ink(.text)
          .numberText(data)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      if race.rank > 1, let name = race.aheadName {
        Text("Behind \(name)")
          .font(TypeScale.caption)
          .ink(.muted)
          .lineLimit(1)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var line: String {
    let place = "#\(race.rank) of \(race.of)"
    if race.rank <= 1 { return "\(place) · leading" }
    if let gap = race.gapKg { return "\(place) · \(Format.volume(gap, data.units)) behind" }
    return place
  }
}

struct EmptyStateView: View {
  var compact: Bool = false

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s1) {
      Text("GainRace")
        .font(compact ? TypeScale.footnoteSemibold : TypeScale.headline)
        .ink(.text)
      Text("Open GainRace to set up")
        .font(compact ? TypeScale.caption : TypeScale.footnote)
        .ink(.muted)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct BlockDivider: View {
  var body: some View {
    Rectangle()
      .ink(.divider)
      .frame(height: 1)
  }
}
