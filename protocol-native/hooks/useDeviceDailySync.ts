import { useEffect, useRef } from 'react'
import { useAuthStore } from '../store/auth'
import { pushDailyHealthKit } from '../lib/healthkit'
import { syncOura } from '../lib/oura'

// Once per app session, after auth, sync connected devices: push yesterday's
// Apple Health data and pull the latest from Oura. Both are no-ops when the
// device isn't connected / offline, and all failures are swallowed — this is a
// background nicety, not part of the core flow.
export function useDeviceDailySync() {
  const user = useAuthStore((s) => s.user)
  const ran = useRef(false)

  useEffect(() => {
    if (!user || ran.current) return
    ran.current = true
    pushDailyHealthKit().catch(() => {})
    syncOura().catch(() => {})
  }, [user])
}
