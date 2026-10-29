// Steps of the app tour shown after onboarding (components/SpotlightTour).
// Each step opens a tab and points at one element there. When that element
// isn't on screen (scrolled away, not rendered yet), it points at the tab
// itself, so the tour never shows a hole over nothing.

export type TourTab = 'index' | 'training' | 'nutrition' | 'body' | 'ask'

export interface TourStep {
  tab: TourTab
  /** useTourTarget id. Tab buttons are 'tab-<name>'. */
  target: string
  title: string
  body: string
}

export const TOUR_STEPS: TourStep[] = [
  {
    tab: 'index',
    target: 'home-score',
    title: 'Your Form Score',
    body: 'One number for how today is going: training, protein, water, sleep and caffeine. Tap it to see what moves it.',
  },
  {
    tab: 'index',
    target: 'home-race',
    title: 'Race your friends',
    body: 'Every week you race friends on weight moved. Add friends here; the recap lands on Sunday.',
  },
  {
    tab: 'training',
    target: 'tab-training',
    title: 'Training',
    body: 'Log sets in a few taps. Every exercise gets a target for next time: one more rep, more weight, or a heads-up when you stall.',
  },
  {
    tab: 'nutrition',
    target: 'nutrition-scan',
    title: 'Log food fast',
    body: 'Snap a photo of your plate, scan a barcode, or search. Save meals you eat often and log them in one tap.',
  },
  {
    tab: 'body',
    target: 'body-scan',
    title: 'Body-fat scan',
    body: 'Four photos give you a body-fat estimate. The photos are analysed and never saved. Track weight and measurements here too.',
  },
  {
    tab: 'ask',
    target: 'pit-segment',
    title: 'Your Pit Crew',
    body: 'Your crew builds a weekly training and meal plan from your data. Chat to change anything: swap a meal, ease off a sore knee, or skip a day.',
  },
  {
    tab: 'index',
    target: 'home-avatar',
    title: 'Your avatar',
    body: 'Your avatar shows how your day is going, and unlocks gear as you level up and hit milestones.',
  },
]
