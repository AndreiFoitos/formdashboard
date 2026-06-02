/**
 * FastAPI returns two shapes for errors:
 * - HTTPException → { detail: "string message" }
 * - Pydantic 422  → { detail: [{ type, loc, msg, input, ctx }, ...] }
 *
 * Rendering the second one directly as a React child crashes. Normalise to a
 * plain string before showing it to the user.
 */
export function extractErrorMessage(err: any, fallback = 'Something went wrong'): string {
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
