package expo.modules.widgetbridge

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Android widgets are phase 4 (docs/widgets-design.md §7). Until then every
// call does nothing, so the shared JS code runs unchanged on Android.
class WidgetBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WidgetBridge")

    Function("setSnapshot") { _: String -> false }

    Function("getSnapshot") { null as String? }

    Function("clearSnapshot") { }

    Function("reloadWidgets") { }

    Function("setWidgetToken") { _: String? -> }
  }
}
