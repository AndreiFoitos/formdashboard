import SwiftUI
import WidgetKit

// Lock-screen families (docs/widgets-design.md §3.4). iOS renders these in
// vibrant mode and picks their fonts; colors only matter in StandBy / full color.

struct LockWidgetView: View {
  @Environment(\.widgetFamily) private var family
  var entry: GainEntry

  var body: some View {
    Group {
      if let data = entry.data {
        switch family {
        case .accessoryInline:
          InlineView(data: data)
        default:
          RectangularView(data: data)
        }
      } else {
        switch family {
        case .accessoryInline:
          Text("Open GainRace to set up")
        default:
          VStack(alignment: .leading) {
            Text("GainRace").font(.headline)
            Text("Open to set up")
          }
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
    .widgetURL(entry.data == nil ? Links.home : Links.nutrition)
    .containerBackground(for: .widget) {
      Color.clear
    }
  }
}

/// "1,640 / 2,400 kcal" · "P 120 g · W 1.5 L"
struct RectangularView: View {
  var data: DayData

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(caloriesLine)
        .font(.headline)
        .numberText(data)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      Text("P \(Format.number(data.proteinG)) g · W \(Format.water(data.waterMl, data.units))")
        .numberText(data)
        .lineLimit(1)
        .minimumScaleFactor(0.7)
      if let target = data.calorieTarget {
        Gauge(value: DayData.progress(data.calories, target)) {
          EmptyView()
        }
        .gaugeStyle(.accessoryLinearCapacity)
        .widgetAccentable()
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  private var caloriesLine: String {
    if let target = data.calorieTarget {
      return "\(Format.number(data.calories)) / \(Format.number(target)) kcal"
    }
    return "\(Format.number(data.calories)) kcal"
  }
}

/// "760 kcal left" / "120 kcal over"
struct InlineView: View {
  var data: DayData

  var body: some View {
    Group {
      if let left = data.caloriesLeft {
        if left >= 0 {
          Text("\(Format.number(left)) kcal left")
        } else {
          Text("\(Format.number(-left)) kcal over")
        }
      } else {
        Text("\(Format.number(data.calories)) kcal")
      }
    }
    .numberText(data)
  }
}

/// Configurable ring (§3.7): calories (kcal left), water, protein, caffeine.
struct CircularWidgetView: View {
  var entry: GainEntry

  var body: some View {
    Group {
      if let data = entry.data {
        CircularMetricView(data: data, metric: entry.metric)
      } else {
        ZStack {
          AccessoryWidgetBackground()
          Image(systemName: "figure.strengthtraining.traditional")
            .font(.title3)
        }
      }
    }
    .widgetURL(entry.data == nil ? Links.home : (entry.metric == .caffeine ? Links.home : Links.nutrition))
    .containerBackground(for: .widget) {
      Color.clear
    }
  }
}

struct CircularMetricView: View {
  var data: DayData
  var metric: LockMetric

  var body: some View {
    switch metric {
    case .calories:
      if let target = data.calorieTarget {
        ring(
          progress: DayData.progress(data.calories, target),
          value: Format.number(abs(target - data.calories)),
          caption: data.calories > target ? "over" : "left"
        )
      } else {
        // No target: just the number, no ring (§2.2).
        plain(value: Format.number(data.calories), caption: "kcal")
      }
    case .water:
      ring(
        progress: DayData.progress(data.waterMl, data.waterTargetMl),
        value: waterValue,
        caption: data.units == .imperial ? "oz" : "L"
      )
    case .protein:
      if let target = data.proteinTargetG {
        ring(progress: DayData.progress(data.proteinG, target), value: Format.number(data.proteinG), caption: "g")
      } else {
        plain(value: Format.number(data.proteinG), caption: "g")
      }
    case .caffeine:
      let mg = data.caffeine?.currentMg ?? data.caffeineMg
      // Full ring at 400 mg, the common daily guidance for adults.
      ring(progress: min(1, Double(mg) / 400), value: Format.number(mg), caption: "mg")
    }
  }

  private var waterValue: String {
    switch data.units {
    case .imperial:
      return Format.number(Int((Double(data.waterMl) / 29.5735).rounded()))
    case .metric:
      let liters = (Double(data.waterMl) / 100).rounded() / 10
      return liters.formatted(.number.precision(.fractionLength(0...1)))
    }
  }

  private func ring(progress: Double, value: String, caption: String) -> some View {
    Gauge(value: progress) {
      Text(caption)
    } currentValueLabel: {
      Text(value)
        .numberText(data)
        .minimumScaleFactor(0.5)
    }
    .gaugeStyle(.accessoryCircularCapacity)
    .widgetAccentable()
  }

  private func plain(value: String, caption: String) -> some View {
    ZStack {
      AccessoryWidgetBackground()
      VStack(spacing: 0) {
        Text(value)
          .font(.headline)
          .numberText(data)
          .minimumScaleFactor(0.5)
        Text(caption)
          .font(.caption2)
      }
      .padding(4)
    }
  }
}
