// Source content for the "How is this calculated?" surface (Settings →
// /methodology). One page per topic + a deduplicated sources page.
//
// All prose comes from the docstrings in backend/services/{form_score,dots,
// stimulants}.py and backend/routers/friends.py; the Pit Crew page from
// services/plan_builder.py and plan_today.py (keep them in sync). URLs are
// included only where the backend code already cites one — author/year
// references are rendered as plain text. Hand-add URLs here if you find them
// later.

export interface Source {
  name: string
  url?: string
}

export interface Topic {
  slug: string
  title: string
  summary: string
  prose: string
  formula: string
  sources: Source[]
}

export const TOPICS: Topic[] = [
  {
    slug: 'form-score',
    title: 'Form Score',
    summary:
      'A daily 0–100 score from data you log in GainRace — habits, not wearables.',
    prose: `Form Score is a daily "Habits Score" derived entirely from data you log in GainRace. Sleep and HRV are intentionally absent — the app doesn't integrate with wearables, and leaving them in the formula would have collapsed almost half the weighting to a flat constant.

Each component scores 0–100, then we take a weighted average. Targets are grounded in published guidance; you can override them per-user in Settings.

Nutrition splits 60% protein / 40% calorie-window because protein is the harder signal to gauge by feel. The calorie sub-score gives full credit within ±10% of target and decays linearly to zero at ±30% — wide enough that one big meal doesn't tank the score.

Training rewards both showing up and intensity: 60 base points for training today, plus up to 40 from today's volume vs your personal 14-day average (capped at 1.5× so one monster session doesn't dominate). Rest days taper by days since last session — 1–2 days off is normal recovery, the curve only gets steep after day 3.

Caffeine penalty follows a sigmoid in residual mg at bedtime: roughly flat under 75 mg, steepens through 150 mg, near-zero past 250 mg. This matches dose-response literature that puts the threshold for measurable sleep disruption around 100 mg taken within 6 h of sleep.

Streak caps at 14 consecutive logged days.`,
    formula: `Form Score = 0.25 × Hydration
           + 0.30 × Nutrition
           + 0.25 × Training
           + 0.10 × Caffeine
           + 0.10 × Streak

Hydration = min(100, water_ml / target_ml × 100)
Nutrition = 0.6 × Protein + 0.4 × Calorie window
Training  = trained × (60 + ratio_vs_14d_avg × 40)
            rest day → tapered by days-since-last
Caffeine  = 100 / (1 + exp((mg_at_bedtime − 150) / 30))
Streak    = min(100, days × 100 / 14)`,
    sources: [
      { name: 'Morton et al. 2018, BJSM meta-analysis — protein 1.6–2.2 g/kg/day' },
      { name: 'EFSA / ACSM joint guidance — hydration ~35 ml/kg/day' },
      { name: 'Cornelis et al.; ISSN caffeine position stand — caffeine half-life ~5h' },
      { name: 'Plews & Buchheit — rolling-baseline framing from HRV research, applied to training volume' },
    ],
  },
  {
    slug: 'dots',
    title: 'DOTS — bodyweight-adjusted strength',
    summary:
      "A fairer leaderboard column than raw kg — adjusts for bodyweight so a 60 kg lifter and a 100 kg lifter compete on the same axis.",
    prose: `DOTS (Dynamic Objective Team Scoring) replaced Wilks as the IPF's primary scoring system in 2019 and is used by USAPL / USPA for "best lifter" awards on non-master lifters. It produces a flatter curve across body weights than Wilks, which over-scored male middleweights and female super-heavyweights.

We apply DOTS in two places: per-set 1RM-adjusted strength (the standard use), and as a coefficient on weekly total volume so the leaderboard's "DOTS-adjusted volume" column compares lifters fairly. Bodyweight inputs are clamped to [35, 200] kg because the polynomial diverges outside that range.

If we don't have your sex or bodyweight, the DOTS column shows "—" and you still rank normally on raw kg.`,
    formula: `DOTS = total_lifted_kg × 500 / poly(bw_kg, sex)

poly(x) = a + b·x + c·x² + d·x³ + e·x⁴

male coefs:    a = -307.75076
               b =   24.0900756
               c =   -0.1918759221
               d =    0.0007391293
               e =   -0.000001093

female coefs:  a =  -57.96288
               b =   13.6175032
               c =   -0.1126655495
               d =    0.0005158568
               e =   -0.0000010706`,
    sources: [
      {
        name: 'IPF 2020 evaluation — Models-Evaluation-I-2020.pdf',
        url: 'https://www.powerlifting.sport/fileadmin/ipf/data/ipf-formula/Models-Evaluation-I-2020.pdf',
      },
      {
        name: 'Published 5th-degree polynomial — liftvault calculator',
        url: 'https://liftvault.com/resources/powerlifting-calculator/',
      },
    ],
  },
  {
    slug: 'caffeine-curve',
    title: 'Caffeine curve',
    summary:
      'How much caffeine is in your system right now — and at bedtime — modeled as exponential decay per substance.',
    prose: `Caffeine follows first-order pharmacokinetics — concentration halves at a roughly fixed interval (the half-life) regardless of starting dose. Each substance gets its own half-life: coffee, espresso, green tea, black tea, and energy drinks all sit at ~5.5 h, while pre-workout supplements use ~5.0 h.

We sum decayed contributions from every drink you've logged today to produce the curve, your current mg, and the predicted residual at your set bedtime. The curve plots 6 AM to 1 AM in 30-minute steps.

Caveat we don't fully model: caffeine metabolism is CYP1A2-genotype-dependent and the linear bedtime penalty in Form Score is simplified — actual sleep impact depends on dose, timing, and your individual half-life.`,
    formula: `caffeine_at_time(t) = dose_mg × 0.5 ^ ((t − logged_at) / half_life)

half-life defaults:
  Coffee / espresso / green tea / black tea / energy drink:  5.5 h
  Pre-workout supplements:                                    5.0 h

current_mg          = Σ caffeine_at_time(now)        over today's logs
mg_at_bedtime       = Σ caffeine_at_time(bedtime)    over today's logs

Form Score caffeine = 100 / (1 + exp((mg_at_bedtime − 150) / 30))
                      (sigmoid: ~99 at 0 mg, 50 at 150 mg, ~1 at 300 mg)`,
    sources: [
      { name: 'ISSN caffeine position stand — half-life baseline ~5 h' },
      { name: 'Drake et al. 2013, J. Clin. Sleep Med. — 100 mg caffeine within 6 h of bedtime measurably disrupts sleep' },
      { name: 'Cornelis et al. — CYP1A2-genotype-dependent caffeine metabolism' },
      { name: 'USDA FoodData Central — per-substance caffeine content' },
    ],
  },
  {
    slug: 'sus-threshold',
    title: 'Sus threshold',
    summary:
      'How many votes light up the 🤨 badge on a friend — scaled so small crews don\'t trivially trigger.',
    prose: `Sus voting is a public callout on a friend's weekly weight-moved total or a specific lift. The threshold for the 🤨 badge is scaled to the size of your friend circle — a 4-person group needs proportionally fewer votes than a 50-person one.

We enforce a minimum of 2 votes regardless of group size: one person calling someone sus shouldn't be enough to light the badge. Per-lift votes count double in the score, because picking a specific lift requires more thought than a single weekly tap.

Vouches use a separate threshold: any friend with ≥ 2 vouches and no active sus badge gets the 🛡️ Trusted badge for the week.`,
    formula: `voters    = circle_size − 1            (target can't vote on self)
threshold = max(2, ⌈voters / 3⌉)

sus_score = weekly_votes + per_lift_votes × 2

is_sus    = sus_score ≥ threshold

(trusted) = vouches ≥ 2 AND NOT is_sus`,
    sources: [
      { name: 'Our own design — no academic literature applies here.' },
      { name: 'The ⌈voters / 3⌉ ratio approximates a minority-quorum convention used in committee voting.' },
    ],
  },
  {
    slug: 'pr-detection',
    title: 'PR detection',
    summary:
      'A new PR is a top set this week that beats your best in the prior 90 days — not just your best ever.',
    prose: `We define a PR as a top set on a given exercise in the current week whose weight exceeds every prior set of the same exercise in the previous 90 days. The 90-day window means returning lifters get credit for hitting old numbers again after a break.

Brand-new exercises don't auto-PR on their first appearance — we require some prior history (prior_best > 0) before calling it a PR. Without that guard, every first-ever set would inflate the "most PRs this week" headline.

PRs feed the Sunday recap on the Friends tab and the "most PRs this week" leaderboard headline.`,
    formula: `prior_best(user, exercise)
   = max(weight_kg) over training_logs
       in [week_start − 90 days, week_start)

week_best(user, exercise)
   = max(weight_kg) over training_logs
       in [week_start, week_end]

is_pr = week_best > prior_best  AND  prior_best > 0`,
    sources: [
      { name: 'Our own definition — the 90-day window is shorter than a lifetime PR by design.' },
    ],
  },
  {
    slug: 'one-rm',
    title: 'Estimated 1RM',
    summary:
      'The heaviest single you could probably lift today, worked backwards from the sets you actually did — you never have to test a true max.',
    prose: `A one-rep max is the most weight you can lift for a single rep. Actually testing one is risky and takes a session of its own, so we estimate it from sets you already log: lift 100kg for 5 reps and the maths puts your single around 115kg.

We run three published formulas and take their mean, because no single one is best across every rep range. Brzycki is accurate at low reps but over-estimates badly past 10, so above 10 reps we drop it from the average rather than clamp it.

Treat the number as a trend line, not a promise. It's most reliable from sets of 3-8 reps; very high-rep sets say more about your endurance than your max. The card shows which set produced each estimate, so you can see what it's working from.`,
    formula: `Epley:    weight x (1 + reps / 30)
Brzycki:  weight x 36 / (37 - reps)     [reps <= 10 only]
Lombardi: weight x reps^0.10

estimate = mean of the applicable formulas

e.g. 100kg x 5:
  Epley    = 100 x (1 + 5/30) = 116.7
  Brzycki  = 100 x 36 / 32    = 112.5
  Lombardi = 100 x 5^0.10     = 117.5
  estimate = 115.6 kg`,
    sources: [
      { name: 'Epley, B. (1985). Poundage Chart. Boyd Epley Workout, Univ. of Nebraska.' },
      { name: 'Brzycki, M. (1993). Strength testing: predicting a one-rep max from reps-to-fatigue. JOPERD 64(1).' },
      { name: 'Lombardi, V.P. (1989). Beginning Weight Training. Wm. C. Brown Publishers.' },
    ],
  },
  {
    slug: 'plans',
    title: 'Pit Crew plans',
    summary:
      'How your training and meal plan is built: what the AI chooses, what our code calculates, and the limits it can never cross.',
    prose: `Claude (Anthropic's AI model) chooses the exercises and the foods. Every number you see is calculated by our code, not by the AI: your calorie and macro targets, your starting weights, and the grams and macros of every meal.

Targets. The plan uses your own calorie and protein targets from Settings, checked against an estimate of your maintenance calories. With 14+ days of logged food and two weeks of weigh-ins, we measure it: what you ate minus what the scale says you stored (about 7,700 kcal per kg). Otherwise we use the Mifflin-St Jeor equation times an activity factor from your training days. Fat is set to 27% of calories and carbs fill the rest.

Safety limits. A plan never goes below your safe minimum: the higher of 1,500 kcal (men) or 1,200 kcal (women), your resting metabolic rate, and 75% of maintenance. It never goes more than 500 kcal above maintenance. Protein stays between 1.6 and 2.4 g per kg. If your target is outside these limits the plan moves it inside and tells you why under "Why this plan?". The chat runs through the same limits. Anyone under 18, or who answered yes to a health question (pregnancy, eating disorder, diabetes, kidney disease), gets a training plan only, and the chat won't change their calories.

Training. The AI can only pick from exercises your equipment allows, minus the ones that load an injury you listed. Weekly hard sets per muscle group are capped (higher for legs, back and arms, which cover several muscles). Starting weights come from your best estimated 1RM in the last 16 weeks, set so you finish each set with about two reps to spare.

Progression. When you hit the top of the rep range on every set at a weight, the next suggestion goes up: 2.5 kg, 5 kg on leg lifts, or 1 kg on light dumbbell work. Until then the weight stays and the goal is the missing reps.

Meals. Foods are looked up in the USDA FoodData Central database. Each day's portions are then scaled to hit your calorie and protein targets together: protein-rich foods and everything else get their own scaling, so a low-protein day leans on its tofu or chicken rather than just shrinking. Portions are rounded to 5 g. If USDA doesn't know a food, the AI's estimate is used and the plan says so. Allergies and your diet style are checked by our code, not trusted to the AI: a plan that breaks one is rebuilt once, and if it still does, the build fails and isn't counted.

Weekly check-in. On Sunday evening the app counts your week (sessions done, exercises you skipped every time, lifts that went up, meals logged, average intake, weight trend) and the AI writes a short review with up to two suggestions: a new calorie target when your weight trend disagrees with your goal, swapping an exercise you keep skipping, or building a fresh plan. Nothing changes until you tap Apply, and applied changes go through the same safety limits.

These plans are general fitness guidance, not medical advice.`,
    formula: `Maintenance (measured) = avg intake − weight trend (kg/wk) × 7,700 / 7
Maintenance (formula)  = Mifflin-St Jeor BMR × activity
  BMR = 10·kg + 6.25·cm − 5·age + (5 men, −161 women)
  activity: ≤1 day 1.2 · 2-3 days 1.375 · 4-5 days 1.55 · 6+ 1.725

Calories: your target, clamped to
  min = max(1,500 men / 1,200 women, BMR, 0.75 × maintenance)
  max = maintenance + 500
Protein:  1.6-2.4 g/kg · Fat: 27% of kcal · Carbs: the rest

Starting weight = e1RM / (1 + (top reps + 2) / 30)
  rounded to 2.5 kg (1 kg under 20 kg)

Next weight, once every set hits the top of the range:
  + 2.5 kg · + 5 kg on leg lifts · + 1 kg under 20 kg`,
    sources: [
      { name: 'Mifflin, M.D. et al. (1990). A new predictive equation for resting energy expenditure in healthy individuals. Am J Clin Nutr 51(2).' },
      { name: 'Donnelly, J.E. et al. (2009). ACSM position stand: appropriate physical activity intervention strategies for weight loss. Med Sci Sports Exerc 41(2).' },
      { name: 'Wishnofsky, M. (1958). Caloric equivalents of gained or lost weight. Am J Clin Nutr 6(5).' },
      { name: 'Morton et al. 2018, BJSM meta-analysis — protein 1.6–2.2 g/kg/day' },
      { name: 'Helms, E.R. et al. (2014). Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation. J Int Soc Sports Nutr 11.' },
      { name: 'Schoenfeld, B.J., Ogborn, D., Krieger, J.W. (2017). Dose-response relationship between weekly resistance training volume and increases in muscle mass. J Sports Sci 35(11).' },
      { name: 'Epley, B. (1985). Poundage Chart. Boyd Epley Workout, Univ. of Nebraska.' },
      { name: 'USDA FoodData Central', url: 'https://fdc.nal.usda.gov/' },
    ],
  },
]

export function getTopic(slug: string): Topic | undefined {
  return TOPICS.find((t) => t.slug === slug)
}

// Flat, deduplicated source list for the /methodology/sources page.
// Two sources count as the same if their `name` field matches exactly.
export function allSources(): Source[] {
  const seen = new Set<string>()
  const out: Source[] = []
  for (const t of TOPICS) {
    for (const s of t.sources) {
      if (seen.has(s.name)) continue
      seen.add(s.name)
      out.push(s)
    }
  }
  return out
}
