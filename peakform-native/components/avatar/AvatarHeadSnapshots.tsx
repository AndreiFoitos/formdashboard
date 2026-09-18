import { useEffect, useMemo, useRef, useState } from 'react'
import { View } from 'react-native'
import type { AvatarBase } from '../../lib/avatar/bodyParams'
import type { AvatarState } from '../../lib/avatar/model'
import { AvatarCanvas, type AvatarCanvasHandle } from './AvatarCanvas'

export interface HeadRequest {
  /** Stable id to look the image up by (e.g. user_id). */
  id: string
  base: AvatarBase
  state: AvatarState
}

// Session cache: identical avatars are only rendered once per app run.
const cache = new Map<string, string>()
const cacheKey = (r: HeadRequest) =>
  JSON.stringify([r.base, r.state.fat, r.state.muscle, r.state.heightScale, r.state.look, r.state.extras ?? null])

/**
 * Renders avatar head close-ups to PNG files with ONE hidden GL view, one
 * avatar at a time, so screens like the race can show many faces as plain
 * images instead of running a 3D view per person.
 *
 * Returns a map id -> file URI that fills in as snapshots finish.
 */
export function useAvatarHeads(requests: HeadRequest[]) {
  const [heads, setHeads] = useState<Record<string, string>>(() => fromCache(requests))
  const pending = useMemo(() => requests.filter((r) => !cache.has(cacheKey(r))), [requests])

  useEffect(() => {
    setHeads(fromCache(requests))
  }, [requests])

  const renderer = pending.length > 0 ? (
    <HeadRenderer
      queue={pending}
      onShot={(req, uri) => {
        cache.set(cacheKey(req), uri)
        setHeads((h) => ({ ...h, [req.id]: uri }))
      }}
    />
  ) : null

  return { heads, renderer }
}

function fromCache(requests: HeadRequest[]) {
  const out: Record<string, string> = {}
  for (const r of requests) {
    const uri = cache.get(cacheKey(r))
    if (uri) out[r.id] = uri
  }
  return out
}

function HeadRenderer({ queue, onShot }: { queue: HeadRequest[]; onShot: (r: HeadRequest, uri: string) => void }) {
  const [index, setIndex] = useState(0)
  const canvas = useRef<AvatarCanvasHandle>(null)
  const busy = useRef(false)
  const current = queue[index]

  useEffect(() => {
    setIndex(0)
  }, [queue])

  if (!current) return null

  const shoot = () => {
    if (busy.current) return
    busy.current = true
    // Let the applied state and camera settle for a frame before reading pixels.
    setTimeout(async () => {
      try {
        const uri = await canvas.current?.snapshot()
        if (uri) onShot(current, uri)
      } catch {
        // Leave this avatar without a face; callers fall back to their dot/initial.
      } finally {
        busy.current = false
        setIndex((i) => i + 1)
      }
    }, 60)
  }

  return (
    <View
      pointerEvents="none"
      // Must be laid out for GL to render, but invisible to the user.
      style={{ position: 'absolute', left: 0, top: 0, width: 128, height: 128, opacity: 0.01 }}
    >
      <AvatarCanvas
        ref={canvas}
        base={current.base}
        state={current.state}
        framing="head"
        animate={false}
        interactive={false}
        style={{ flex: 1 }}
        errorFallback={null}
        onReady={shoot}
      />
    </View>
  )
}
