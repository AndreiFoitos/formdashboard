import SwiftUI
import WidgetKit

// Phase 1: read-only widgets (docs/widgets-design.md §7). Phase 2 adds the
// Control Center controls here, wrapped in `if #available(iOS 18, *)`.

@main
struct GainRaceWidgets: WidgetBundle {
  var body: some Widget {
    GainRaceHomeWidget()
    GainRaceLockWidget()
    GainRaceCircularWidget()
  }
}

struct GainRaceHomeWidget: Widget {
  let kind = "GainRaceHome"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: GainProvider()) { entry in
      HomeWidgetView(entry: entry)
    }
    .configurationDisplayName("Today")
    .description("Calories, protein and water. Larger sizes add caffeine, your plan and the race.")
    .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
  }
}

struct GainRaceLockWidget: Widget {
  let kind = "GainRaceLock"

  var body: some WidgetConfiguration {
    StaticConfiguration(kind: kind, provider: GainProvider()) { entry in
      LockWidgetView(entry: entry)
    }
    .configurationDisplayName("Calories")
    .description("Today's calories, protein and water.")
    .supportedFamilies([.accessoryRectangular, .accessoryInline])
  }
}

struct GainRaceCircularWidget: Widget {
  let kind = "GainRaceCircular"

  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: kind, intent: LockMetricIntent.self, provider: CircularProvider()) { entry in
      CircularWidgetView(entry: entry)
    }
    .configurationDisplayName("Ring")
    .description("Calories left, water, protein or caffeine.")
    .supportedFamilies([.accessoryCircular])
  }
}
