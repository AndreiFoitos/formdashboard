import { openFromWidget, widgetTarget } from '../lib/widgetLinks'

// Rewrites incoming system URLs before Expo Router routes them. Only widget
// links (gainrace://widget/...) are touched; every other link passes through.
export function redirectSystemPath({ path, initial }: { path: string; initial: boolean }): string {
  try {
    const target = widgetTarget(path)
    if (!target) return path
    // Cold start: route normally; the app opens straight on that screen.
    if (initial) return target
    // Running: navigate ourselves. An empty path tells the router to skip it.
    openFromWidget(target)
    return ''
  } catch {
    return path
  }
}
