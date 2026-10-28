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
}

struct Ring: View {
  var progress: Double
  var color: Color
  var lineWidth: CGFloat = 5

  var body: some View {
    ZStack {
      Circle()
        .stroke(Tokens.surfaceRaised, lineWidth: lineWidth)
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
        Capsule().fill(Tokens.surfaceRaised)
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
        .foregroundStyle(Tokens.textMuted)
        .frame(width: 12, alignment: .leading)
      Bar(progress: DayData.progress(value, target), color: hit ? Tokens.success : color)
      Text(valueText)
        .font(TypeScale.caption)
        .foregroundStyle(Tokens.text)
        .numberText(data)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .fixedSize(horizontal: true, vertical: false)
    }
  }
}

/// Calorie ring + number + "760 left", then protein and water bars.
/// The Small widget, and the left half of Medium / Large / XL.
struct NutritionSummary: View {
  var data: DayData

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      HStack(spacing: Space.s3) {
        if let target = data.calorieTarget {
          let hit = DayData.goalHit(data.calories, target)
          Ring(progress: DayData.progress(data.calories, target), color: hit ? Tokens.success : Tokens.accent)
            .overlay(
              Text("kcal")
                .font(TypeScale.caption)
                .foregroundStyle(Tokens.textSubtle)
            )
            .frame(width: 48, height: 48)
        }
        VStack(alignment: .leading, spacing: 0) {
          Text(Format.number(data.calories))
            .font(TypeScale.title)
            .foregroundStyle(Tokens.text)
            .numberText(data)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
          leftLine
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

  @ViewBuilder
  private var leftLine: some View {
    if let left = data.caloriesLeft {
      if left >= 0 {
        Text("\(Format.number(left)) left")
          .font(TypeScale.caption)
          .foregroundStyle(Tokens.textMuted)
          .numberText(data)
      } else {
        Text("\(Format.number(-left)) over")
          .font(TypeScale.caption)
          .foregroundStyle(Tokens.warning)
          .numberText(data)
      }
    } else {
      Text("kcal")
        .font(TypeScale.caption)
        .foregroundStyle(Tokens.textMuted)
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
          .foregroundStyle(Tokens.text)
          .numberText(data)
          .lineLimit(1)
          .minimumScaleFactor(0.7)
        Text(data.caffeine != nil ? "Caffeine now" : "Caffeine today")
          .font(TypeScale.caption)
          .foregroundStyle(Tokens.textSubtle)
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
        .foregroundStyle(Tokens.textMuted)
        .lineLimit(1)
    } else if let workout = data.plan?.workoutName {
      Text(workout)
        .font(TypeScale.footnote)
        .foregroundStyle(Tokens.textMuted)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    } else {
      Text("Not trained yet")
        .font(TypeScale.footnote)
        .foregroundStyle(Tokens.textMuted)
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
      let pts = caffeine.points
      if pts.count >= 2, let first = pts.first?.date, let last = pts.last?.date, last > first {
        let span = last.timeIntervalSince(first)
        let peak = max(100, pts.map { $0.mg }.max() ?? 0)
        let w = geo.size.width
        let h = geo.size.height
        let inset: CGFloat = 4
        let x = { (d: Date) -> CGFloat in CGFloat(d.timeIntervalSince(first) / span) * w }
        let y = { (mg: Double) -> CGFloat in inset + (h - 2 * inset) * CGFloat(1 - min(mg, peak) / peak) }
        let clampedNow = min(max(now, first), last)
        let nowMg = DayData.interpolate(pts, at: clampedNow) ?? 0
        let nowPoint = CGPoint(x: x(clampedNow), y: y(nowMg))

        ZStack(alignment: .topLeading) {
          Path { p in
            p.move(to: CGPoint(x: 0, y: y(pts[0].mg)))
            for pt in pts where pt.date < clampedNow {
              p.addLine(to: CGPoint(x: x(pt.date), y: y(pt.mg)))
            }
            p.addLine(to: nowPoint)
          }
          .stroke(Tokens.textMuted, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))

          Path { p in
            p.move(to: nowPoint)
            for pt in pts where pt.date > clampedNow {
              p.addLine(to: CGPoint(x: x(pt.date), y: y(pt.mg)))
            }
          }
          .stroke(Tokens.textMuted, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round, dash: [3, 4]))

          Circle()
            .fill(caffeineColor(Int(nowMg.rounded())))
            .frame(width: 8, height: 8)
            .position(nowPoint)
            .widgetAccentable()
        }
      }
    }
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
          .foregroundStyle(Tokens.textSubtle)
        Spacer(minLength: Space.s2)
        Text("\(Format.number(caffeine.currentMg)) mg now")
          .font(TypeScale.footnoteSemibold)
          .foregroundStyle(Tokens.text)
          .numberText(data)
        Text("· \(Format.number(caffeine.atBedtimeMg)) mg at bedtime")
          .font(TypeScale.caption)
          .foregroundStyle(Tokens.textMuted)
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
        .foregroundStyle(Tokens.text)
        .lineLimit(1)
        .minimumScaleFactor(0.8)
      if plan.mealsPlanned > 0 {
        if let meal = plan.nextMeal {
          Text("Next: \(meal.slot) · \(Format.capitalized(meal.name)) · \(Format.number(meal.kcal)) kcal")
            .font(TypeScale.caption)
            .foregroundStyle(Tokens.textMuted)
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
          .foregroundStyle(Tokens.textSubtle)
        Text(line)
          .font(TypeScale.footnoteSemibold)
          .foregroundStyle(Tokens.text)
          .numberText(data)
          .lineLimit(1)
          .minimumScaleFactor(0.8)
      }
      if race.rank > 1, let name = race.aheadName {
        Text("Behind \(name)")
          .font(TypeScale.caption)
          .foregroundStyle(Tokens.textMuted)
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
        .foregroundStyle(Tokens.text)
      Text("Open GainRace to set up")
        .font(compact ? TypeScale.caption : TypeScale.footnote)
        .foregroundStyle(Tokens.textMuted)
        .fixedSize(horizontal: false, vertical: true)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

struct BlockDivider: View {
  var body: some View {
    Rectangle()
      .fill(Tokens.divider)
      .frame(height: 1)
  }
}
