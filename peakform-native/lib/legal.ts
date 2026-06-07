/**
 * Centralized legal / support links surfaced in the UI.
 *
 * These point at gainrace.com — the brand finalized 2026-06-07. The pages
 * themselves still need to be hosted (privacy.html + terms.html from
 * USER_ACTIONS.md BLOCKER-6). Apple App Store Connect ALSO requires you to
 * enter PRIVACY_POLICY_URL in the app's submission form. Keep these values
 * (here + ASC) in sync.
 */

export const PRIVACY_POLICY_URL = 'https://gainrace.com/privacy'
export const TERMS_OF_SERVICE_URL = 'https://gainrace.com/terms'

/**
 * Email shown for support / data requests. Keep this monitored — under GDPR,
 * users have a right to data-access and erasure requests, and 30 days is the
 * statutory response window.
 */
export const SUPPORT_EMAIL = 'support@gainrace.com'
