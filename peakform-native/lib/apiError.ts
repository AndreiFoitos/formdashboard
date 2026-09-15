/**
 * FastAPI returns two shapes for errors:
 * - HTTPException → { detail: "string message" }
 * - Pydantic 422  → { detail: [{ type, loc, msg, input, ctx }, ...] }
 *
 * Rendering the second one directly as a React child crashes. Normalise to a
 * plain string before showing it to the user.
 */
export function extractErrorMessage(err: any, fallback = 'Something went wrong'): string {
  // No response at all: timeout or no connectivity. axios's raw messages
  // ("timeout of 30000ms exceeded", "Network Error") aren't user-facing.
  if (err?.isAxiosError && !err.response) {
    return err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT'
      ? 'The server took too long to respond. Try again in a moment.'
      : "Can't reach the server. Check your connection and try again."
  }
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d && typeof d.msg === 'string' ? d.msg : null))
      .filter(Boolean) as string[]
    if (msgs.length > 0) return msgs.join('. ')
  }
  if (typeof err?.message === 'string') return err.message
  return fallback
}
