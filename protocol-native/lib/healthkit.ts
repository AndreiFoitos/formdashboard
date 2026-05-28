import { Platform } from 'react-native'
import Constants, { ExecutionEnvironment } from 'expo-constants'
import type {
  QuantityTypeIdentifier,
  StatisticsOptions,
} from '@kingstinct/react-native-healthkit'
import { api } from '../api/client'

// Expo Go can't load custom native modules — attempting to import the HealthKit
// Nitro module there crashes the app. Only a dev build / standalone has it.
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient

// Lazy-load the native module. `@kingstinct/react-native-healthkit` is a Nitro
// module that only exists in a custom dev build — importing it at the top level
// would crash Expo Go / Android merely by navigating to a screen that imports
// this file. Deferring the import to call-time (Metro caches it) keeps those
// environments safe; HealthKit calls are also Platform-guarded below.
const loadHK = () => import('@kingstinct/react-native-healthkit')

const READ_TYPES = [
  'HKQuantityTypeIdentifierStepCount',
  'HKQuantityTypeIdentifierActiveEnergyBurned',
  'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  'HKCategoryTypeIdentifierSleepAnalysis',
] as const

// CategoryValueSleepAnalysis: asleepUnspecified=1, asleepCore=3, asleepDeep=4,
// asleepREM=5 count as "asleep"; inBed=0 and awake=2 do not.
const ASLEEP_VALUES = new Set([1, 3, 4, 5])

export interface DailyHealthData {
  date: string // YYYY-MM-DD, local calendar day
  sleep_duration_hours: number | null
  hrv_avg: number | null
  steps: number | null
  active_calories: number | null
}

export function isHealthKitPlatform(): boolean {
  // iOS only, and never in Expo Go (loading the native module there would crash).
  return Platform.OS === 'ios' && !isExpoGo
}

export async function isHealthAvailable(): Promise<boolean> {
  if (!isHealthKitPlatform()) return false
  try {
    const HK = await loadHK()
    return await HK.isHealthDataAvailable()
  } catch {
    return false
  }
}

export async function requestHealthPermissions(): Promise<boolean> {
  if (!isHealthKitPlatform()) return false
  const HK = await loadHK()
  // HealthKit never reveals whether READ access was granted (Apple privacy) —
  // this resolves once the prompt is handled. Queries simply return empty data
  // for any type the user declined.
  return HK.requestAuthorization({ toRead: READ_TYPES })
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function dailyQuantityByDate(
  identifier: QuantityTypeIdentifier,
  statistic: StatisticsOptions,
  unit: string,
  start: Date,
  end: Date,
): Promise<Map<string, number>> {
  const HK = await loadHK()
  const buckets = await HK.queryStatisticsCollectionForQuantity(
    identifier,
    [statistic],
    start, // anchor at local midnight → buckets are aligned to local days
    { day: 1 },
    { unit, filter: { date: { startDate: start, endDate: end } } },
  )
  const map = new Map<string, number>()
  for (const b of buckets) {
    if (!b.startDate) continue
    const q = statistic === 'cumulativeSum' ? b.sumQuantity : b.averageQuantity
    if (q) map.set(toLocalDateStr(new Date(b.startDate)), q.quantity)
  }
  return map
}

async function sleepHoursByDate(start: Date, end: Date): Promise<Map<string, number>> {
  const HK = await loadHK()
  const samples = await HK.queryCategorySamples('HKCategoryTypeIdentifierSleepAnalysis', {
    filter: { date: { startDate: start, endDate: end } },
    ascending: true,
    limit: 0, // 0 = all
  })
  const map = new Map<string, number>()
  for (const s of samples) {
    if (!ASLEEP_VALUES.has(s.value as number)) continue
    const hours = (new Date(s.endDate).getTime() - new Date(s.startDate).getTime()) / 3_600_000
    if (hours <= 0) continue
    // Attribute a night's sleep to the morning you woke up on.
    const key = toLocalDateStr(new Date(s.endDate))
    map.set(key, (map.get(key) ?? 0) + hours)
  }
  return map
}

export async function gatherDailyHealthData(days: number): Promise<DailyHealthData[]> {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)
  start.setHours(0, 0, 0, 0)

  const [steps, energy, hrv, sleep] = await Promise.all([
    dailyQuantityByDate('HKQuantityTypeIdentifierStepCount', 'cumulativeSum', 'count', start, end),
    dailyQuantityByDate('HKQuantityTypeIdentifierActiveEnergyBurned', 'cumulativeSum', 'kcal', start, end),
    dailyQuantityByDate('HKQuantityTypeIdentifierHeartRateVariabilitySDNN', 'discreteAverage', 'ms', start, end),
    sleepHoursByDate(start, end),
  ])

  const dates = new Set<string>([
    ...steps.keys(),
    ...energy.keys(),
    ...hrv.keys(),
    ...sleep.keys(),
  ])

  return [...dates]
    .map((date) => ({
      date,
      steps: steps.has(date) ? Math.round(steps.get(date)!) : null,
      active_calories: energy.has(date) ? Math.round(energy.get(date)!) : null,
      hrv_avg: hrv.has(date) ? Math.round(hrv.get(date)!) : null,
      sleep_duration_hours: sleep.has(date) ? Math.round(sleep.get(date)! * 10) / 10 : null,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function runHealthKitBackfill(
  days = 14,
): Promise<{ backfilled_days: number; form_score_unlocked: boolean }> {
  const today = toLocalDateStr(new Date())
  // Today is still in progress — leave it to the daily push / manual logging.
  const data = (await gatherDailyHealthData(days)).filter((d) => d.date !== today)
  const res = await api.post('/devices/healthkit/backfill', { days: data })
  return res.data
}

export interface ConnectedDevice {
  provider: string
  sync_enabled: boolean
  connected_at: string | null
  last_sync_at: string | null
}

export async function fetchConnectedDevices(): Promise<ConnectedDevice[]> {
  const res = await api.get('/devices/connected')
  return res.data
}

export async function disconnectDevice(provider: string): Promise<void> {
  await api.delete(`/devices/disconnect/${provider}`)
}

export async function pushDailyHealthKit(): Promise<boolean> {
  if (!isHealthKitPlatform()) return false

  const HK = await loadHK()
  // Only sync if the user has already been through the HealthKit prompt —
  // avoids creating a phantom device connection for users who never connected.
  try {
    const status = await HK.getRequestStatusForAuthorization({ toRead: READ_TYPES })
    if (status === HK.AuthorizationRequestStatus.shouldRequest) return false
  } catch {
    return false
  }

  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const key = toLocalDateStr(yesterday)
  const day = (await gatherDailyHealthData(2)).find((d) => d.date === key)
  if (!day) return false

  await api.post('/devices/healthkit/daily', day)
  return true
}
