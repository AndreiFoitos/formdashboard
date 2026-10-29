import Foundation

// The snapshot the app writes (lib/widgets.ts, docs/widgets-design.md §2.2).
// Every field is optional so a partial or older snapshot decodes; anything that
// doesn't decode, or a `v` other than 1, is treated as "no data" (empty state).
// Unknown keys are ignored by JSONDecoder.

struct WidgetSnapshot: Decodable {
  struct Today: Decodable {
    var date: String?
    var calories: Double?
    var calorieTarget: Double?
    var proteinG: Double?
    var proteinTargetG: Double?
    var waterMl: Double?
    var waterTargetMl: Double?
    var caffeineMg: Double?
    var trained: Bool?
  }

  struct CurvePoint: Decodable {
    var time: String?
    var mg: Double?
  }

  struct Caffeine: Decodable {
    var currentMg: Double?
    var atBedtimeMg: Double?
    var bedtimeHour: Double?
    var impactLevel: String?
    var curve: [CurvePoint]?
  }

  struct Meal: Decodable {
    var slot: String?
    var name: String?
    var kcal: Double?
  }

  struct Plan: Decodable {
    var workoutName: String?
    var restDay: Bool?
    var nextWorkoutName: String?
    var nextMeal: Meal?
    var mealsLeft: Double?
    var mealsPlanned: Double?
  }

  struct Race: Decodable {
    var rank: Double?
    var of: Double?
    var myKg: Double?
    var gapKg: Double?
    var aheadName: String?
  }

  var v: Int?
  var updatedAt: String?
  var units: String?
  var hideOnLockScreen: Bool?
  var today: Today?
  var caffeine: Caffeine?
  var plan: Plan?
  var race: Race?
}

enum SnapshotStore {
  // Must match modules/widget-bridge/ios/WidgetBridgeModule.swift.
  static let appGroup = "group.com.gainrace.app"
  static let key = "widget.snapshot.v1"

  static func load() -> WidgetSnapshot? {
    guard
      let defaults = UserDefaults(suiteName: appGroup),
      let json = defaults.string(forKey: key),
      let data = json.data(using: .utf8),
      let snapshot = try? JSONDecoder().decode(WidgetSnapshot.self, from: data),
      snapshot.v == 1,
      snapshot.today?.date != nil
    else { return nil }
    return snapshot
  }
}

// MARK: - Resolved data for one timeline entry

enum UnitSystem {
  case metric, imperial
}

struct CaffeineData {
  var points: [(date: Date, mg: Double)]
  var currentMg: Int
  var atBedtimeMg: Int
}

struct PlanData {
  var workoutName: String?
  var restDay: Bool
  var nextWorkoutName: String?
  var nextMeal: (slot: String, name: String, kcal: Int)?
  var mealsLeft: Int
  var mealsPlanned: Int
}

struct RaceData {
  var rank: Int
  var of: Int
  var gapKg: Int?
  var aheadName: String?
}

/// What the views draw at one moment. Built from the snapshot for each
/// timeline entry date, so a new day shows zeros without the app running.
struct DayData {
  var calories: Int
  var calorieTarget: Int?
  var proteinG: Int
  var proteinTargetG: Int?
  var waterMl: Int
  var waterTargetMl: Int
  var caffeineMg: Int
  var trained: Bool
  var caffeine: CaffeineData?
  var plan: PlanData?
  var race: RaceData?
  var units: UnitSystem
  var hideNumbers: Bool

  /// Same fallback as the app's Today water card.
  static let defaultWaterTargetMl = 2500

  init(snapshot s: WidgetSnapshot, at date: Date) {
    let today = s.today
    // §2.3: numbers belong to `today.date`. On a later local day everything
    // resets to 0 / target and the day-bound blocks hide until the app writes.
    let sameDay = today?.date == DayData.localDay(date)

    calories = sameDay ? DayData.int(today?.calories) : 0
    calorieTarget = DayData.positiveInt(today?.calorieTarget)
    proteinG = sameDay ? DayData.int(today?.proteinG) : 0
    proteinTargetG = DayData.positiveInt(today?.proteinTargetG)
    waterMl = sameDay ? DayData.int(today?.waterMl) : 0
    waterTargetMl = DayData.positiveInt(today?.waterTargetMl) ?? DayData.defaultWaterTargetMl
    caffeineMg = sameDay ? DayData.int(today?.caffeineMg) : 0
    trained = sameDay ? (today?.trained ?? false) : false
    units = s.units == "imperial" ? .imperial : .metric
    hideNumbers = s.hideOnLockScreen ?? false

    if sameDay, let c = s.caffeine {
      var points: [(date: Date, mg: Double)] = []
      for p in c.curve ?? [] {
        if let t = p.time, let d = DayData.parseDate(t) {
          points.append((date: d, mg: max(0, p.mg ?? 0)))
        }
      }
      points.sort { $0.date < $1.date }
      let current = DayData.interpolate(points, at: date) ?? (c.currentMg ?? 0)
      caffeine = CaffeineData(
        points: points,
        currentMg: Int(current.rounded()),
        atBedtimeMg: DayData.int(c.atBedtimeMg)
      )
    } else {
      caffeine = nil
    }

    if sameDay, let p = s.plan {
      var meal: (slot: String, name: String, kcal: Int)? = nil
      if let m = p.nextMeal, let name = m.name {
        meal = (slot: m.slot ?? "", name: name, kcal: DayData.int(m.kcal))
      }
      plan = PlanData(
        workoutName: p.workoutName,
        restDay: p.restDay ?? false,
        nextWorkoutName: p.nextWorkoutName,
        nextMeal: meal,
        mealsLeft: DayData.int(p.mealsLeft),
        mealsPlanned: DayData.int(p.mealsPlanned)
      )
    } else {
      plan = nil
    }

    // The race is weekly (Monday start), so it survives a new day but not a
    // new week.
    let newWeek = !sameDay && Calendar.current.component(.weekday, from: date) == 2
    if let r = s.race, !newWeek, let rank = r.rank, let of = r.of, of > 1 {
      race = RaceData(
        rank: Int(rank),
        of: Int(of),
        gapKg: r.gapKg.map { Int($0.rounded()) },
        aheadName: r.aheadName
      )
    } else {
      race = nil
    }
  }

  init(
    calories: Int, calorieTarget: Int?, proteinG: Int, proteinTargetG: Int?,
    waterMl: Int, waterTargetMl: Int, caffeineMg: Int, trained: Bool,
    caffeine: CaffeineData?, plan: PlanData?, race: RaceData?,
    units: UnitSystem, hideNumbers: Bool
  ) {
    self.calories = calories
    self.calorieTarget = calorieTarget
    self.proteinG = proteinG
    self.proteinTargetG = proteinTargetG
    self.waterMl = waterMl
    self.waterTargetMl = waterTargetMl
    self.caffeineMg = caffeineMg
    self.trained = trained
    self.caffeine = caffeine
    self.plan = plan
    self.race = race
    self.units = units
    self.hideNumbers = hideNumbers
  }

  // MARK: Derived values

  var caloriesLeft: Int? {
    guard let target = calorieTarget else { return nil }
    return target - calories
  }

  /// 0...1 for rings and bars.
  static func progress(_ value: Int, _ target: Int?) -> Double {
    guard let target = target, target > 0 else { return 0 }
    return min(1, max(0, Double(value) / Double(target)))
  }

  static func goalHit(_ value: Int, _ target: Int?) -> Bool {
    guard let target = target, target > 0 else { return false }
    return value >= target
  }

  // MARK: Helpers

  static func int(_ v: Double?) -> Int {
    guard let v = v, v.isFinite else { return 0 }
    return Int(v.rounded())
  }

  static func positiveInt(_ v: Double?) -> Int? {
    guard let v = v, v.isFinite, v > 0 else { return nil }
    return Int(v.rounded())
  }

  static func localDay(_ date: Date) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: date)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }

  private static let isoPlain: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
  }()

  private static let isoFractional: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
  }()

  static func parseDate(_ s: String) -> Date? {
    return isoPlain.date(from: s) ?? isoFractional.date(from: s)
  }

  /// Linear interpolation on the curve; nil without points.
  static func interpolate(_ points: [(date: Date, mg: Double)], at date: Date) -> Double? {
    guard let first = points.first, let last = points.last else { return nil }
    if date <= first.date { return first.mg }
    if date >= last.date { return last.mg }
    for i in 1..<points.count {
      let a = points[i - 1]
      let b = points[i]
      if date <= b.date {
        let span = b.date.timeIntervalSince(a.date)
        if span <= 0 { return b.mg }
        let t = date.timeIntervalSince(a.date) / span
        return a.mg + (b.mg - a.mg) * t
      }
    }
    return last.mg
  }
}

// MARK: - Formatting (DESIGN.md §9: locale grouping, a space before units)

enum Format {
  static func number(_ n: Int) -> String {
    return n.formatted(.number)
  }

  /// For the small lock-screen ring: 760 → "760", 2757 → "2.8k" (locale decimal).
  static func compact(_ n: Int) -> String {
    if abs(n) < 1000 { return number(n) }
    let thousands = (Double(n) / 100).rounded() / 10
    return "\(thousands.formatted(.number.precision(.fractionLength(0...1))))k"
  }

  static func water(_ ml: Int, _ units: UnitSystem) -> String {
    switch units {
    case .imperial:
      return "\(number(Int((Double(ml) / 29.5735).rounded()))) oz"
    case .metric:
      if ml >= 1000 {
        let liters = (Double(ml) / 100).rounded() / 10
        return "\(liters.formatted(.number.precision(.fractionLength(0...1)))) L"
      }
      return "\(number(ml)) ml"
    }
  }

  static func volume(_ kg: Int, _ units: UnitSystem) -> String {
    switch units {
    case .imperial:
      return "\(number(Int((Double(kg) * 2.20462).rounded()))) lb"
    case .metric:
      return "\(number(kg)) kg"
    }
  }

  /// "salmon bowl" → "Salmon bowl" (food names, display only).
  static func capitalized(_ s: String) -> String {
    guard let first = s.first else { return s }
    return String(first).uppercased() + s.dropFirst()
  }
}
