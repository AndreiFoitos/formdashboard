// The one number formatter (DESIGN.md §9): thousands separators from the
// device locale, and always a space between a number and its unit.

/** 2200 → "2,200"; 82.46 with decimals=1 → "82.5". Trailing zeros dropped. */
export function formatNumber(n: number, decimals = 0): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: 0 })
}

/** Fixed decimals, e.g. body weight "82.0". Still locale-grouped. */
export function formatFixed(n: number, decimals: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals })
}

/** 2200, 'kcal' → "2,200 kcal". */
export function withUnit(n: number, unit: string, decimals = 0): string {
  return `${formatNumber(n, decimals)} ${unit}`
}
