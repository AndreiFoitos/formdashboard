import AppIntents
import SwiftUI
import WidgetKit

struct GainEntry: TimelineEntry {
  let date: Date
  /// nil: no snapshot / logged out → "Open GainRace to set up".
  let data: DayData?
  var metric: LockMetric = .calories
}

enum Timelines {
  /// Entries now and every 15 min for the next 2 hours (moves the caffeine
  /// "now" marker), plus local midnight when it falls inside that window (the
  /// day resets). After the last one WidgetKit asks for a new timeline, about
  /// 12 reloads a day. WidgetKit renders every entry up front, so a whole day
  /// of 15-min entries is too heavy for the larger sizes.
  static func entries(now: Date, metric: LockMetric) -> [GainEntry] {
    let snapshot = SnapshotStore.load()
    func entry(_ d: Date) -> GainEntry {
      GainEntry(date: d, data: snapshot.map { DayData(snapshot: $0, at: d) }, metric: metric)
    }

    let calendar = Calendar.current
    let midnight =
      calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))
      ?? now.addingTimeInterval(24 * 60 * 60)
    let windowEnd = min(now.addingTimeInterval(2 * 60 * 60), midnight)

    var result = [entry(now)]
    let quarter: TimeInterval = 15 * 60
    var t = (now.timeIntervalSinceReferenceDate / quarter).rounded(.down) * quarter + quarter
    while t < windowEnd.timeIntervalSinceReferenceDate {
      result.append(entry(Date(timeIntervalSinceReferenceDate: t)))
      t += quarter
    }
    result.append(entry(windowEnd))
    return result
  }

  static func current(metric: LockMetric, inPreview: Bool) -> GainEntry {
    let now = Date()
    if let s = SnapshotStore.load() {
      return GainEntry(date: now, data: DayData(snapshot: s, at: now), metric: metric)
    }
    // The widget gallery shows sample numbers instead of the setup message.
    let sample: DayData? = inPreview ? DayData.sample(at: now) : nil
    return GainEntry(date: now, data: sample, metric: metric)
  }
}

/// Home screen families and the rectangular / inline lock-screen ones.
struct GainProvider: TimelineProvider {
  func placeholder(in context: Context) -> GainEntry {
    GainEntry(date: Date(), data: DayData.sample(at: Date()))
  }

  func getSnapshot(in context: Context, completion: @escaping (GainEntry) -> Void) {
    completion(Timelines.current(metric: .calories, inPreview: context.isPreview))
  }

  func getTimeline(in context: Context, completion: @escaping (Timeline<GainEntry>) -> Void) {
    completion(Timeline(entries: Timelines.entries(now: Date(), metric: .calories), policy: .atEnd))
  }
}

// MARK: - Circular lock-screen metric (§3.7)

enum LockMetric: String, AppEnum {
  case calories
  case water
  case protein
  case caffeine

  static var typeDisplayRepresentation: TypeDisplayRepresentation { "Metric" }
  static var caseDisplayRepresentations: [LockMetric: DisplayRepresentation] {
    [
      .calories: "Calories",
      .water: "Water",
      .protein: "Protein",
      .caffeine: "Caffeine",
    ]
  }
}

struct LockMetricIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource { "Ring" }
  static var description: IntentDescription { "Choose what the ring shows." }

  @Parameter(title: "Shows", default: .calories)
  var metric: LockMetric
}

struct CircularProvider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> GainEntry {
    GainEntry(date: Date(), data: DayData.sample(at: Date()))
  }

  func snapshot(for configuration: LockMetricIntent, in context: Context) async -> GainEntry {
    Timelines.current(metric: configuration.metric, inPreview: context.isPreview)
  }

  func timeline(for configuration: LockMetricIntent, in context: Context) async -> Timeline<GainEntry> {
    Timeline(entries: Timelines.entries(now: Date(), metric: configuration.metric), policy: .atEnd)
  }
}

// MARK: - Sample data (widget gallery and placeholders)

extension DayData {
  static func sample(at date: Date) -> DayData {
    let calendar = Calendar.current
    let start = calendar.date(bySettingHour: 6, minute: 0, second: 0, of: date) ?? date
    let mgs: [Double] = [0, 0, 95, 150, 140, 125, 110, 95, 150, 175, 160, 140, 120, 105, 90, 78, 66, 56, 48, 40, 34, 29, 24, 20, 17]
    let points = mgs.enumerated().map { (i, mg) in
      (date: start.addingTimeInterval(Double(i) * 45 * 60), mg: mg)
    }
    return DayData(
      calories: 1640, calorieTarget: 2400,
      proteinG: 120, proteinTargetG: 160,
      waterMl: 1500, waterTargetMl: 3000,
      caffeineMg: 190, trained: true,
      caffeine: CaffeineData(points: points, currentMg: Int(DayData.interpolate(points, at: date) ?? 95), atBedtimeMg: 40),
      plan: PlanData(
        workoutName: "Push day", restDay: false, nextWorkoutName: nil,
        nextMeal: (slot: "dinner", name: "Salmon bowl", kcal: 640),
        mealsLeft: 2, mealsPlanned: 4
      ),
      race: RaceData(rank: 2, of: 6, gapKg: 1320, aheadName: "Alex"),
      units: .metric, hideNumbers: false
    )
  }
}
