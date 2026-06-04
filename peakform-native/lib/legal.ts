/**
 * Centralized legal / support links surfaced in the UI.
 *
 * NOTE: these URLs ship in every build. When you (the developer) decide on
 * a real production domain (BLOCKER-8 from PRE_SUBMISSION_TODO.md), edit the
 * values below to point at your hosted copies. The current placeholder values
 * resolve to `https://peakformapp.com/...` — they will 404 until you host the
 * pages described in USER_ACTIONS.md entry for BLOCKER-6.
 *
 * Apple App Store Connect ALSO requires you to enter PRIVACY_POLICY_URL in the
 * app's submission form. Keep these two values (here + ASC) in sync.
 */

export const PRIVACY_POLICY_URL = 'https://peakformapp.com/privacy'
export const TERMS_OF_SERVICE_URL = 'https://peakformapp.com/terms'

/**
 * Email shown for support / data requests. Keep this monitored — under GDPR,
 * users have a right to data-access and erasure requests, and 30 days is the
 * statutory response window.
 */
export const SUPPORT_EMAIL = 'support@peakformapp.com'
