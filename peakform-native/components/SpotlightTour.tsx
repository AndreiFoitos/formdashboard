import { useEffect, useState } from 'react'
import { Modal, Text, TouchableOpacity, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native'
import { router } from 'expo-router'
import Svg, { Defs, Mask, Rect as SvgRect } from 'react-native-svg'
import { TOUR_STEPS } from '../lib/tour'
import { hapticLight, hapticSuccess } from '../lib/haptics'
import { useTourStore, type Rect } from '../store/tour'
import { TOUR_CARD_GAP, TOUR_SPOTLIGHT_PAD } from '../theme/layout'
import { colors } from '../theme/tokens'

// The app tour: dims the app, cuts a rounded hole around the element the
// step is about, and shows a card next to it. Steps live in lib/tour.ts;
// screens mark their elements with useTourTarget (store/tour.ts).

const RADIUS = 16 // rounded-xl, matches the cards it highlights

export function SpotlightTour() {
  const { active, step, rects, go, stop } = useTourStore()
  const { width: W, height: H } = useWindowDimensions()
  const [cardHeight, setCardHeight] = useState(0)
  // Hide the hole while the tab changes, so it doesn't sit over the old screen.
  const [settled, setSettled] = useState(false)

  const s = TOUR_STEPS[step]

  useEffect(() => {
    if (!active || !s) return
    setSettled(false)
    router.navigate(s.tab === 'index' ? '/' : `/${s.tab}`)
    const t = setTimeout(() => setSettled(true), 700)
    return () => clearTimeout(t)
  }, [active, step])

  if (!active || !s) return null

  const onScreen = (r?: Rect) => r && r.y >= 0 && r.y + r.height <= H
  const target = onScreen(rects[s.target]) ? rects[s.target] : rects[`tab-${s.tab}`]
  const hole = settled && target
    ? {
        x: target.x - TOUR_SPOTLIGHT_PAD,
        y: target.y - TOUR_SPOTLIGHT_PAD,
        width: target.width + TOUR_SPOTLIGHT_PAD * 2,
        height: target.height + TOUR_SPOTLIGHT_PAD * 2,
      }
    : null

  // Card below the hole when the hole is in the top half, else above it.
  const below = hole ? hole.y + hole.height / 2 < H / 2 : false
  const cardTop = hole
    ? below
      ? Math.min(hole.y + hole.height + TOUR_CARD_GAP, H - cardHeight - TOUR_CARD_GAP)
      : Math.max(hole.y - cardHeight - TOUR_CARD_GAP, TOUR_CARD_GAP)
    : (H - cardHeight) / 2

  const last = step === TOUR_STEPS.length - 1

  function next() {
    if (last) {
      hapticSuccess()
      stop()
      router.navigate('/')
    } else {
      hapticLight()
      go(step + 1)
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={stop} statusBarTranslucent>
      <View className="flex-1">
        <Svg width={W} height={H} style={{ position: 'absolute', top: 0, left: 0 }}>
          <Defs>
            <Mask id="tour-hole">
              <SvgRect x={0} y={0} width={W} height={H} fill="white" />
              {hole && <SvgRect {...hole} rx={RADIUS} ry={RADIUS} fill="black" />}
            </Mask>
          </Defs>
          <SvgRect x={0} y={0} width={W} height={H} fill={colors.bg} fillOpacity={0.82} mask="url(#tour-hole)" />
          {hole && (
            <SvgRect {...hole} rx={RADIUS} ry={RADIUS} fill="none" stroke={colors.text} strokeOpacity={0.6} strokeWidth={1.5} />
          )}
        </Svg>

        <View
          onLayout={(e: LayoutChangeEvent) => setCardHeight(e.nativeEvent.layout.height)}
          className="absolute left-4 right-4 bg-surface border border-border rounded-xl p-4"
          style={{ borderCurve: 'continuous', top: cardTop, opacity: cardHeight ? 1 : 0 }}
        >
          <Text className="text-text-subtle text-caption">
            {step + 1} of {TOUR_STEPS.length}
          </Text>
          <Text className="text-text text-headline mt-1">{s.title}</Text>
          <Text className="text-text-muted text-footnote mt-2">{s.body}</Text>
          <View className="flex-row items-center justify-between mt-4">
            {last ? (
              <View />
            ) : (
              <TouchableOpacity onPress={stop} className="py-3 pr-4" hitSlop={8}>
                <Text className="text-text-muted text-footnote font-medium">Skip tour</Text>
              </TouchableOpacity>
            )}
            <View className="flex-row gap-2">
              {step > 0 && (
                <TouchableOpacity
                  onPress={() => { hapticLight(); go(step - 1) }}
                  className="px-4 py-3 rounded-md bg-surface-raised"
                  style={{ borderCurve: 'continuous' }}
                >
                  <Text className="text-text text-footnote font-semibold">Back</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={next} className="px-4 py-3 rounded-md bg-accent" style={{ borderCurve: 'continuous' }}>
                <Text className="text-on-accent text-footnote font-semibold">{last ? "Let's go" : 'Next'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  )
}
