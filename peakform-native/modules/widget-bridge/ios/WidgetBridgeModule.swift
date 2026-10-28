import ExpoModulesCore
import WidgetKit

// Must match targets/widget/Snapshot.swift.
private let appGroup = "group.com.gainrace.app"
private let snapshotKey = "widget.snapshot.v1"

public class WidgetBridgeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WidgetBridge")

    // The app writes, the widget only reads (docs/widgets-design.md §2).
    // Stored as a JSON string; the widget decodes it and treats anything it
    // can't decode as "no data".
    Function("setSnapshot") { (json: String) -> Bool in
      guard let defaults = UserDefaults(suiteName: appGroup) else { return false }
      defaults.set(json, forKey: snapshotKey)
      return true
    }

    Function("getSnapshot") { () -> String? in
      return UserDefaults(suiteName: appGroup)?.string(forKey: snapshotKey)
    }

    Function("clearSnapshot") { () -> Void in
      guard let defaults = UserDefaults(suiteName: appGroup) else { return }
      defaults.removeObject(forKey: snapshotKey)
    }

    Function("reloadWidgets") { () -> Void in
      WidgetCenter.shared.reloadAllTimelines()
    }

    // Phase 3: saves the scoped widget token to the shared keychain group
    // ($(AppIdentifierPrefix)com.gainrace.app.shared). No-op until then.
    Function("setWidgetToken") { (_: String?) -> Void in
    }
  }
}
