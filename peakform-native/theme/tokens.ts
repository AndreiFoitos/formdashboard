// Design tokens — the single source of truth for color and type (DESIGN.md §2, §3).
// Wired into tailwind.config.js. Import from here for raw values (SVG, three, Switch).

export const colors = {
  bg: '#000000',
  surface: '#18181b',
  'surface-raised': '#27272a',
  divider: '#27272a',
  border: '#3f3f46',
  text: '#fafafa',
  'text-muted': '#a1a1aa',
  'text-subtle': '#71717a',
  accent: '#2c66fb',
  'on-accent': '#ffffff',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  // Charts, scales and badges only (DESIGN.md §2).
  score: { low: '#ef4444', midLow: '#f97316', midHigh: '#eab308', high: '#22c55e' },
  data: {
    protein: '#818cf8',
    carbs: '#34d399',
    fat: '#fbbf24',
    water: '#38bdf8',
    weight: '#fafafa',
    bodyfat: '#a78bfa',
    form: '#2c66fb',
    volume: '#fafafa',
  },
  muscle: {
    chest: '#f87171',
    back: '#34d399',
    legs: '#f472b6',
    shoulders: '#60a5fa',
    arms: '#a78bfa',
    core: '#facc15',
    other: '#a8a29e',
  },
  medal: { gold: '#FCD34D', silver: '#D1D5DB', bronze: '#B45309' },
} as const;

export const fontSize = {
  caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
  footnote: ['14px', { lineHeight: '20px' }],
  body: ['16px', { lineHeight: '22px' }],
  headline: ['18px', { lineHeight: '24px', fontWeight: '600' }],
  title: ['24px', { lineHeight: '30px', fontWeight: '700' }],
  display: ['32px', { lineHeight: '38px', fontWeight: '700' }],
  hero: ['48px', { lineHeight: '52px', fontWeight: '800' }],
} as const;
