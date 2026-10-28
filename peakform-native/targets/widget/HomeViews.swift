import SwiftUI
import WidgetKit

// Home screen families (docs/widgets-design.md §3.1–3.3). Blocks with no data
// (no plan, no friends, a new day) hide and the others take the space.

struct HomeWidgetView: View {
  @Environment(\.widgetFamily) private var family
  var entry: GainEntry

  var body: some View {
    Group {
      if let data = entry.data {
        switch family {
        case .systemSmall:
          SmallView(data: data)
        case .systemMedium:
          MediumView(data: data)
        case .systemLarge:
          LargeView(data: data, now: entry.date)
        case .systemExtraLarge:
          ExtraLargeView(data: data, now: entry.date)
        default:
          SmallView(data: data)
        }
      } else {
        EmptyStateView(compact: family == .systemSmall)
          .widgetURL(Links.home)
      }
    }
    .containerBackground(for: .widget) {
      Tokens.surface
    }
  }
}

/// §3.1 — tap opens Nutrition.
struct SmallView: View {
  var data: DayData

  var body: some View {
    NutritionSummary(data: data)
      .widgetURL(Links.nutrition)
  }
}

/// §3.2 — phase 1 right side: caffeine now + trained / rest day.
struct MediumView: View {
  var data: DayData

  var body: some View {
    MediumContent(data: data)
  }
}

struct MediumContent: View {
  var data: DayData

  var body: some View {
    HStack(spacing: Space.s4) {
      Link(destination: Links.nutrition) {
        NutritionSummary(data: data)
      }
      Rectangle()
        .fill(Tokens.divider)
        .frame(width: 1)
      Link(destination: Links.home) {
        StatusColumn(data: data)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
      .frame(maxWidth: 120)
    }
  }
}

/// §3.3 — Medium + caffeine curve + Pit Crew today + friends race.
struct LargeView: View {
  var data: DayData
  var now: Date

  var body: some View {
    VStack(alignment: .leading, spacing: Space.s2) {
      MediumContent(data: data)
        .frame(height: 112)
      if let caffeine = data.caffeine {
        BlockDivider()
        Link(destination: Links.home) {
          CaffeineBlock(caffeine: caffeine, data: data, now: now)
        }
      }
      if let plan = data.plan {
        BlockDivider()
        Link(destination: Links.pit) {
          PlanBlock(plan: plan, data: data)
        }
      }
      if let race = data.race {
        BlockDivider()
        Link(destination: Links.friends) {
          RaceBlock(race: race, data: data)
        }
      }
      // Without a curve to stretch, keep the blocks at the top.
      if data.caffeine == nil {
        Spacer(minLength: 0)
      }
    }
  }
}

/// §3.3 — iPad: Medium + caffeine left, plan + race right.
struct ExtraLargeView: View {
  var data: DayData
  var now: Date

  var body: some View {
    HStack(alignment: .top, spacing: Space.s4) {
      VStack(alignment: .leading, spacing: Space.s3) {
        MediumContent(data: data)
          .frame(height: 112)
        if let caffeine = data.caffeine {
          BlockDivider()
          Link(destination: Links.home) {
            CaffeineBlock(caffeine: caffeine, data: data, now: now)
          }
        } else {
          Spacer(minLength: 0)
        }
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

      if data.plan != nil || data.race != nil {
        Rectangle()
          .fill(Tokens.divider)
          .frame(width: 1)
        VStack(alignment: .leading, spacing: Space.s3) {
          if let plan = data.plan {
            Link(destination: Links.pit) {
              PlanBlock(plan: plan, data: data)
            }
          }
          if data.plan != nil && data.race != nil {
            BlockDivider()
          }
          if let race = data.race {
            Link(destination: Links.friends) {
              RaceBlock(race: race, data: data)
            }
          }
          Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      }
    }
  }
}
