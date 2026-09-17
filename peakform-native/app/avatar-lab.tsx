// Avatar lab — internal test screen for the 3D avatar spike.
// Measures FPS / snapshot cost on real devices and lets us eyeball how body
// metrics and daily habits drive the model. Not a user-facing feature.

import { useMemo, useRef, useState } from 'react'
import { Image, PanResponder, ScrollView, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { useAuthStore } from '../store/auth'
import { AvatarCanvas, type AvatarCanvasHandle, type AvatarSource } from '../components/avatar/AvatarCanvas'
import { computeBodyParams, computeDailyEffects, type AvatarBase } from '../lib/avatar/bodyParams'
import type { AvatarLook, AvatarState, HeadStyle } from '../lib/avatar/model'

const SKINS = ['#f2d0b1', '#e0ac85', '#c68a5e', '#8d5a3b', '#5a3825']
const HAIRS = ['#1a1410', '#4a3121', '#a8733f', '#d9c27a']
const TOPS = ['#2563eb', '#1f2937', '#dc2626', '#16a34a']

export default function AvatarLab() {
  const user = useAuthStore((s) => s.user)
  const [base, setBase] = useState<AvatarBase>(user?.sex ?? 'male')
  const [age, setAge] = useState(user?.age ?? 25)
  const [height, setHeight] = useState(user?.height_cm ?? 178)
  const [weight, setWeight] = useState(user?.weight_kg ?? 78)
  const [bfOverride, setBfOverride] = useState<number | null>(null)
  const [trained, setTrained] = useState(false)
  const [waterHit, setWaterHit] = useState(false)
  const [highCaffeine, setHighCaffeine] = useState(false)
  const [head, setHead] = useState<HeadStyle>('human')
  const [source, setSource] = useState<AvatarSource>('glb')
  // 3D is only mounted on request, so a GL/model failure can be pinned to one of the two models.
  const [started, setStarted] = useState(false)
  const [look, setLook] = useState<Omit<AvatarLook, 'head'>>({
    skin: SKINS[2],
    hair: HAIRS[1],
    top: TOPS[0],
    bottom: '#111827',
    shoes: '#f4f4f5',
  })
  const [fps, setFps] = useState<number | null>(null)
  const [snap, setSnap] = useState<{ uri: string; ms: number } | null>(null)
  const canvas = useRef<AvatarCanvasHandle>(null)

  const body = useMemo(
    () => computeBodyParams({ sex: base, age, heightCm: height, weightKg: weight, bodyFatPct: bfOverride }),
    [base, age, height, weight, bfOverride],
  )
  const state = useMemo<AvatarState>(
    () => ({
      fat: body.fat,
      muscle: body.muscle,
      heightScale: body.heightScale,
      look: { ...look, head },
      effects: computeDailyEffects({ trained, waterHit, highCaffeine }),
    }),
    [body, look, head, trained, waterHit, highCaffeine],
  )

  async function takeSnapshot() {
    const t0 = Date.now()
    const uri = await canvas.current?.snapshot()
    if (uri) setSnap({ uri, ms: Date.now() - t0 })
  }

  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <View className="flex-row items-center px-4 pt-2 pb-2">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="-ml-1 pr-4 py-2 flex-row items-center" style={{ gap: 2 }}>
          <ChevronLeft size={22} color="#d4d4d8" strokeWidth={2.25} />
          <Text className="text-zinc-300 text-base font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold">Avatar lab</Text>
      </View>

      <View style={{ height: 340 }} className="mx-4 rounded-3xl bg-zinc-900 overflow-hidden">
        {started ? (
          <AvatarCanvas key={source} ref={canvas} base={base} source={source} state={state} onFps={setFps} style={{ flex: 1 }} />
        ) : (
          <View className="flex-1 items-center justify-center px-6" style={{ gap: 10 }}>
            <Text className="text-zinc-400 text-xs text-center">3D is off. Start it with one of the models:</Text>
            {(['placeholder', 'glb'] as const).map((s) => (
              <TouchableOpacity
                key={s}
                onPress={() => {
                  setSource(s)
                  setStarted(true)
                }}
                className="bg-white rounded-xl px-4 py-2.5"
              >
                <Text className="text-black text-sm font-semibold">
                  {s === 'glb' ? 'Start MakeHuman model' : 'Start placeholder model'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View pointerEvents="none" className="absolute top-3 left-3 bg-black/60 rounded-lg px-2 py-1">
          <Text className="text-emerald-400 text-xs font-mono">{fps ?? '–'} fps</Text>
        </View>
        {snap && (
          <View pointerEvents="none" className="absolute top-3 right-3 items-center">
            <Image source={{ uri: snap.uri }} style={{ width: 56, height: 90, borderRadius: 8, backgroundColor: '#27272a' }} />
            <Text className="text-zinc-400 text-[10px] mt-1">{snap.ms} ms</Text>
          </View>
        )}
      </View>

      <ScrollView className="flex-1 px-4" contentContainerStyle={{ paddingTop: 16, paddingBottom: 48, gap: 18 }}>
        <Chips label="Model" options={['glb', 'placeholder'] as const} value={source} onChange={setSource} />
        <Chips label="Base" options={['male', 'female'] as const} value={base} onChange={setBase} />

        <LabSlider label="Age" unit="y" min={16} max={80} step={1} value={age} onChange={setAge} />
        <LabSlider label="Height" unit="cm" min={145} max={210} step={1} value={height} onChange={setHeight} />
        <LabSlider label="Weight" unit="kg" min={40} max={160} step={0.5} value={weight} onChange={setWeight} />
        <LabSlider
          label={bfOverride == null ? 'Body fat (estimated — drag to set)' : 'Body fat'}
          unit="%"
          min={5}
          max={50}
          step={0.5}
          value={bfOverride ?? Math.round(body.bodyFatPct * 2) / 2}
          onChange={setBfOverride}
        />
        {bfOverride != null && (
          <TouchableOpacity onPress={() => setBfOverride(null)}>
            <Text className="text-sky-400 text-xs -mt-3">Use estimate from BMI instead</Text>
          </TouchableOpacity>
        )}

        <View className="bg-zinc-900 rounded-2xl px-4 py-3">
          <Text className="text-zinc-400 text-xs font-mono">
            BMI {body.bmi.toFixed(1)} · BF {body.bodyFatPct.toFixed(1)}%{body.bodyFatEstimated ? ' (est)' : ''} · FFMI{' '}
            {body.ffmi.toFixed(1)}
          </Text>
          <Text className="text-white text-sm font-mono mt-1">
            fat {body.fat.toFixed(2)} · muscle {body.muscle.toFixed(2)} · height ×{body.heightScale.toFixed(2)}
          </Text>
        </View>

        <View>
          <SectionLabel>Today (stacking effects)</SectionLabel>
          <View className="flex-row flex-wrap" style={{ gap: 8 }}>
            <Toggle label="Trained → pump" on={trained} onPress={() => setTrained((v) => !v)} />
            <Toggle label="Water hit → glow" on={waterHit} onPress={() => setWaterHit((v) => !v)} />
            <Toggle label="High caffeine → jitter" on={highCaffeine} onPress={() => setHighCaffeine((v) => !v)} />
          </View>
        </View>

        {source === 'placeholder' && (
          <Chips label="Head slot" options={['human', 'gorilla'] as const} value={head} onChange={setHead} />
        )}
        <Swatches label="Skin" colors={SKINS} value={look.skin} onChange={(skin) => setLook((l) => ({ ...l, skin }))} />
        <Swatches label="Hair" colors={HAIRS} value={look.hair} onChange={(hair) => setLook((l) => ({ ...l, hair }))} />
        <Swatches label="Top" colors={TOPS} value={look.top} onChange={(top) => setLook((l) => ({ ...l, top }))} />

        <TouchableOpacity onPress={takeSnapshot} className="bg-white rounded-2xl py-3.5 items-center">
          <Text className="text-black font-semibold">Take snapshot (race marker image)</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

// ─── Small controls ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text className="text-zinc-400 text-xs uppercase tracking-widest mb-2">{children}</Text>
}

function Chips<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly T[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <View>
      <SectionLabel>{label}</SectionLabel>
      <View className="flex-row" style={{ gap: 8 }}>
        {options.map((o) => (
          <TouchableOpacity
            key={o}
            onPress={() => onChange(o)}
            className="flex-1 py-2.5 rounded-xl border items-center"
            style={{ backgroundColor: value === o ? 'white' : '#18181b', borderColor: value === o ? 'white' : '#3f3f46' }}
          >
            <Text className="text-sm font-semibold capitalize" style={{ color: value === o ? 'black' : '#a1a1aa' }}>
              {o}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  )
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className="px-3 py-2 rounded-xl border"
      style={{ backgroundColor: on ? '#052e16' : '#18181b', borderColor: on ? '#22c55e' : '#3f3f46' }}
    >
      <Text className="text-xs font-medium" style={{ color: on ? '#4ade80' : '#a1a1aa' }}>
        {label}
      </Text>
    </TouchableOpacity>
  )
}

function Swatches({
  label,
  colors,
  value,
  onChange,
}: {
  label: string
  colors: string[]
  value: string
  onChange: (c: string) => void
}) {
  return (
    <View>
      <SectionLabel>{label}</SectionLabel>
      <View className="flex-row" style={{ gap: 10 }}>
        {colors.map((c) => (
          <TouchableOpacity
            key={c}
            onPress={() => onChange(c)}
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              backgroundColor: c,
              borderWidth: 2,
              borderColor: value === c ? 'white' : 'transparent',
            }}
          />
        ))}
      </View>
    </View>
  )
}

function LabSlider({
  label,
  unit,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string
  unit: string
  min: number
  max: number
  step: number
  value: number
  onChange: (v: number) => void
}) {
  const width = useRef(1)
  const latest = useRef({ min, max, step, onChange })
  latest.current = { min, max, step, onChange }

  const pan = useMemo(() => {
    const set = (x: number) => {
      const { min, max, step, onChange } = latest.current
      const ratio = Math.min(1, Math.max(0, x / width.current))
      onChange(Math.round((min + ratio * (max - min)) / step) * step)
    }
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => set(e.nativeEvent.locationX),
      onPanResponderMove: (e) => set(e.nativeEvent.locationX),
    })
  }, [])

  const pct = ((value - min) / (max - min)) * 100
  return (
    <View>
      <View className="flex-row justify-between mb-2">
        <Text className="text-zinc-400 text-xs uppercase tracking-widest">{label}</Text>
        <Text className="text-white text-xs font-mono">
          {Number.isInteger(value) ? value : value.toFixed(1)} {unit}
        </Text>
      </View>
      <View
        onLayout={(e) => (width.current = e.nativeEvent.layout.width)}
        style={{ height: 28, justifyContent: 'center' }}
        {...pan.panHandlers}
      >
        <View pointerEvents="none" style={{ height: 6, borderRadius: 3, backgroundColor: '#27272a' }}>
          <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: '#fafafa' }} />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: `${pct}%`,
            marginLeft: -11,
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: 'white',
          }}
        />
      </View>
    </View>
  )
}
