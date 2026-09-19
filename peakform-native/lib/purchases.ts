/**
 * App Store purchases via RevenueCat.
 *
 * The app only talks to Apple (through RevenueCat's SDK). What the user may do
 * is decided by the backend: after any purchase or restore we call
 * POST /billing/sync, which re-reads the purchase from RevenueCat server-side
 * and updates the plan (backend/services/billing.py). RevenueCat is logged in
 * with our user id so both sides agree on who bought what.
 *
 * EXPO_PUBLIC_REVENUECAT_IOS_KEY is RevenueCat's public iOS SDK key (safe to
 * ship). Without it (or on Android / Expo Go) purchases are disabled and the
 * paywall says so instead of crashing.
 */
import { Platform } from 'react-native'
import Purchases, {
  PRODUCT_CATEGORY,
  PURCHASES_ERROR_CODE,
  type PurchasesPackage,
  type PurchasesStoreProduct,
} from 'react-native-purchases'
import { api } from '../api/client'
import type { PlanPayload } from '../hooks/usePlan'

const IOS_KEY = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY ?? ''

export const purchasesEnabled = Platform.OS === 'ios' && IOS_KEY.length > 0

export const SUBSCRIPTION_PRODUCTS = {
  plus: { monthly: 'com.gainrace.plus.monthly', yearly: 'com.gainrace.plus.yearly' },
  pro: { monthly: 'com.gainrace.pro.monthly', yearly: 'com.gainrace.pro.yearly' },
} as const

let configured = false
let currentUserId: string | null = null

/** Called whenever the signed-in user changes (AuthGate). */
export async function syncPurchasesUser(userId: string | null): Promise<void> {
  if (!purchasesEnabled || userId === currentUserId) return
  try {
    if (userId && !configured) {
      Purchases.configure({ apiKey: IOS_KEY, appUserID: userId })
      configured = true
    } else if (userId) {
      await Purchases.logIn(userId)
    } else if (configured) {
      await Purchases.logOut()
    }
    currentUserId = userId
  } catch {
    // logOut throws when RevenueCat already holds an anonymous user; harmless.
    currentUserId = userId
  }
}

/** Subscription packages from RevenueCat's current offering, keyed by product id. */
export async function loadSubscriptionPackages(): Promise<Record<string, PurchasesPackage>> {
  if (!purchasesEnabled) return {}
  const offerings = await Purchases.getOfferings()
  const out: Record<string, PurchasesPackage> = {}
  for (const p of offerings.current?.availablePackages ?? []) out[p.product.identifier] = p
  return out
}

/** Product ids whose introductory offer (the 7-day trial) this Apple ID can still use. */
export async function trialEligible(productIds: string[]): Promise<Set<string>> {
  if (!purchasesEnabled || productIds.length === 0) return new Set()
  const res = await Purchases.checkTrialOrIntroductoryPriceEligibility(productIds)
  return new Set(
    Object.entries(res)
      .filter(([, v]) => v.status === Purchases.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE)
      .map(([id]) => id),
  )
}

export async function loadPackProducts(productIds: string[]): Promise<Record<string, PurchasesStoreProduct>> {
  if (!purchasesEnabled || productIds.length === 0) return {}
  const products = await Purchases.getProducts(productIds, PRODUCT_CATEGORY.NON_SUBSCRIPTION)
  return Object.fromEntries(products.map((p) => [p.identifier, p]))
}

async function syncWithServer(): Promise<PlanPayload> {
  const { data } = await api.post<PlanPayload>('/billing/sync')
  return data
}

/** Buys a subscription. Resolves to the new plan, or null if the user cancelled. */
export async function buyPackage(pkg: PurchasesPackage): Promise<PlanPayload | null> {
  try {
    await Purchases.purchasePackage(pkg)
  } catch (e) {
    if (isCancelled(e)) return null
    throw e
  }
  return syncWithServer()
}

/** Buys an avatar pack. Resolves to the new plan payload, or null if cancelled. */
export async function buyProduct(product: PurchasesStoreProduct): Promise<PlanPayload | null> {
  try {
    await Purchases.purchaseStoreProduct(product)
  } catch (e) {
    if (isCancelled(e)) return null
    throw e
  }
  return syncWithServer()
}

export async function restorePurchases(): Promise<PlanPayload> {
  if (purchasesEnabled) await Purchases.restorePurchases()
  return syncWithServer()
}

/** Apple's own manage/cancel sheet. */
export async function manageSubscription(): Promise<void> {
  if (purchasesEnabled) await Purchases.showManageSubscriptions()
}

function isCancelled(e: any): boolean {
  return e?.code === PURCHASES_ERROR_CODE.PURCHASE_CANCELLED_ERROR || e?.userCancelled === true
}
