# AI training + meal plans (v1 design)

Tab name: **Pit Crew** (tab label "Pit"; the chat speaks as "your crew").
Code uses neutral names (`ai_plans`, `/plan-ai/...`) so the label can change freely.

Status: approved 2026-10-02 (limits, chat may change kcal, Sonnet 5.5). Name: Pit Crew.

## 1. What we're building

The **Ask** tab becomes **Pit Crew**. It has two parts:

1. **Your plan.** A weekly training plan and meal plan that Claude writes from
   everything we know about the user. Today's workout and meals sit at the top
   and can be logged in one tap.
2. **Chat.** The existing "ask your data" chat, now able to *change* the plan:
   "I don't like salmon", "I'm getting pizza tonight", "my shoulder hurts, swap
   overhead press". Preferences it learns are saved and used for every future plan.

Both share one richer data summary, so Ask also stops being nearly blind
(today it sees protein, water, caffeine, Form Score and trained Y/N only).

### Not in v1
- The automatic weekly check-in that rewrites next week (v2).
- Recipes and grocery lists (v2).
- Cardio and running programming. v1 plans strength training only.

## 2. User flow

```
Onboarding ──► (new) Training step ──► (new) Food step ──► done
                                                   │
Pit Crew tab, no plan yet:  [ Build my plan ]  ◄──────┘
        │  (runs in the background, ~30-90 s, push when ready)
        ▼
Pit Crew tab, plan ready:
  ┌──────────────────────────────────────┐
  │ TODAY · Push day                     │
  │ Bench 4×6-8 @ 72.5 kg   ▸ Start      │
  │ ...                                  │
  │ Breakfast  Oats + whey  540 kcal  ✓ │
  │ Lunch      Chicken rice 720 kcal  ⇄ │  ⇄ = swap
  │ Today: 1,840 / 2,450 kcal · 142/180 P│
  ├──────────────────────────────────────┤
  │ This week ▸   Why this plan? ▸       │
  ├──────────────────────────────────────┤
  │ Chat                                 │
  │  you: I hate salmon                  │
  │  ai: Noted. Swapped Thu dinner to    │
  │         chicken thighs + potatoes.   │
  │         [Undo]                       │
  │ [ Ask or change something…       ]   │
  └──────────────────────────────────────┘
```

## 3. Onboarding changes

Already asked: sex, age, height, weight, sleep, caffeine, training frequency,
and Cut / Maintain / Bulk. **Cut / Maintain / Bulk is currently thrown away.**
`onboarding.tsx` uses it to compute `calorie_target` and never sends it.
Fix: send `goal` in the onboarding request and store it.

Two new steps, tap-only, both skippable ("I'll tell it later"):

**Your training**
- Where: Gym · Home with weights · Bodyweight only
- Experience: New (<6 months) · Some (6 months–2 years) · Experienced (2+ years)
- Session length: 30 · 45 · 60 · 90 min
- Anything hurt? Shoulder · Knee · Lower back · Wrist · Other (free text) · None

**Your food**
- Style: Anything · Vegetarian · Vegan · Pescatarian · Halal · Kosher
- Allergies: Nuts · Dairy · Gluten · Eggs · Shellfish · Soy · Other
- Foods you won't eat: free-text chips ("mushrooms", "salmon")
- Cooking: Minimal (<15 min) · Some (30 min) · Love it
- Health check, a single screen: "Any of these apply? Pregnant or breastfeeding ·
  Eating disorder history · Diabetes · Kidney disease · None". See §8.

Existing users get the same two steps as a card in Pit Crew the first time they
open it.

## 4. Data model (one Alembic migration)

### `user_preferences` (1:1 with users)
| column | type | notes |
|---|---|---|
| user_id | UUID PK, FK users | |
| goal | String(10) | `cut` / `maintain` / `bulk`, nullable |
| equipment | String(16) | `gym` / `home_weights` / `bodyweight` |
| experience | String(12) | `new` / `some` / `experienced` |
| session_minutes | SmallInteger | |
| training_days | SmallInteger | derived from `training_frequency` if not set |
| injuries | JSONB list[str] | |
| diet_style | String(16) | |
| allergies | JSONB list[str] | **hard constraint** |
| dislikes | JSONB list[str] | soft constraint, grows from chat |
| cooking | String(10) | |
| health_flags | JSONB list[str] | gates the meal plan, see §8 |
| notes | JSONB list[str] | other facts the chat saved ("works night shifts") |
| updated_at | DateTime | |

### `ai_plans`
| column | type | notes |
|---|---|---|
| id | UUID PK | |
| user_id | FK users | |
| status | String(12) | `generating` / `ready` / `failed` / `archived` |
| week_start | Date | user-local Monday |
| plan | JSONB | the *validated* plan (§6), edited in place by swaps |
| targets | JSONB | kcal, protein, carbs, fat per day |
| rationale | Text | the "Why this plan?" text |
| meal_plan_enabled | Boolean | false when blocked by §8 |
| input_tokens / output_tokens | Integer | for cost tracking |
| created_at / updated_at | DateTime | |

Only one row per user is `ready`. Making a new plan archives the old one.

### `ai_messages`
| column | type | notes |
|---|---|---|
| id | UUID PK | |
| user_id | FK users | |
| role | String(10) | `user` / `assistant` |
| content | Text | |
| actions | JSONB | tool calls made this turn, for the Undo chip |
| created_at | DateTime | |

Chats now survive leaving the tab. The model sees the last 20 messages.

### Existing tables, no schema change
- `nutrition_logs.source = 'plan'` and `training_logs.source = 'plan'` when
  logged from the plan. That's enough to measure adherence in v2.

## 5. Shared context builder: `services/plan_context.py`

One function, `build_context(user, db, days)`, returns a compact text block
(~1.5–3K tokens) used by both plan generation and chat. `answer_question` in
`ai_features.py` switches to it, which upgrades Ask before any plan exists.

Contents:
- Profile: sex, age, height, weight, goal, preferences (§4).
- Targets: kcal, protein, water.
- Last `days` days (plan perk 30/90/365, as now), averaged by week:
  kcal, P/C/F, days protein target hit, training days, Form Score, caffeine.
  Estimated rows are excluded, as now.
- Weight trend: kg/week slope from `body_metrics`, plus the latest body-fat %.
- Strength: top estimated 1RM per exercise (`services/one_rm.py`), last 8 weeks.
- Detected split (`user_splits`).
- Top 20 frequent foods and saved meal names, so plans use food the user
  actually eats.

## 6. Plan generation

`POST /plan-ai/plan` → checks the plan quota (§9), inserts a `generating` row,
starts a background task, and returns immediately. The app polls
`GET /plan-ai/plan` every 3 s while the tab is open. A push notification fires
when it's ready. This avoids Render's request timeout on the free plan, and the
cron pinger keeps the instance awake while it runs.

### The Claude call
- Model: `CLAUDE_MODEL` (Sonnet 5, unchanged). Adaptive thinking on, `max_tokens` 16000.
- System prompt: role, programming rules, safety rules, and the
  exercise list (keys from `EXERCISE_TO_GROUP` + the user's custom exercises).
  Cached.
- User message: the context block (§5).
- Output: structured output (`output_config.format` JSON schema), so the result
  is always parseable.

### What Claude returns

Claude writes a small **meal library** and a schedule that points into it,
not 28 separate meals. That means fewer output tokens and fewer USDA lookups,
and swapping a meal means changing one entry.

```jsonc
{
  "rationale": "You're cutting at ~0.4 kg/week ...",       // 3-5 sentences
  "training": {
    "days": [
      { "weekday": 0, "name": "Push",
        "exercises": [
          { "key": "bench_press", "sets": 4, "reps_min": 6, "reps_max": 8,
            "intensity_pct_1rm": 75, "note": "2 min rest" }
        ] }
    ]
  },
  "nutrition": {
    "macro_split": { "protein_g_per_kg": 2.0, "fat_pct": 28 },
    "meals": [
      { "id": "m1", "name": "Oats + whey", "slot": "breakfast",
        "items": [ { "food": "rolled oats", "grams": 80 },
                   { "food": "whey protein", "grams": 30 } ] }
    ],
    "week": [ { "weekday": 0, "meals": ["m1", "m4", "m7", "m10"] } ]
  }
}
```

Claude never outputs calories, macros or kilograms. The backend calculates them.

### Validation and numbers (all in code, `services/plan_builder.py`)
*As built (step 3):*
1. **Targets.** The user's own calorie and protein targets are used, so the plan
   never disagrees with the rest of the app. They're checked against a TDEE
   estimate: measured (logged intake minus the weight trend × 7,700 kcal/kg)
   when there are 14+ logged days and 2+ weeks of weigh-ins, else Mifflin-St Jeor
   × activity. The §8 limits then apply, and any change is listed in
   `targets.notes`. Protein is clamped to 1.6–2.4 g/kg; fat is 27% of kcal; carbs
   fill the rest. The plan doesn't change the user's settings (the chat can).
2. **Exercises.** The schema's `key` is an enum of the exercises this user may
   do, so equipment and preset-injury exclusions (`INJURY_EXCLUDES`) hold by
   construction. Free-text injuries only reach the prompt. Sets, reps and rest
   are clamped, duplicate weekdays dropped, and a weekly set cap per muscle group
   (Legs 34, Back 26, Arms 24, Core 16, others 20) trims accessories first.
3. **Starting weights.** The best estimated 1RM from the last 16 weeks, with Epley
   inverted for `reps_max` + 2 reps in reserve, rounded to 2.5 kg (1 kg under
   20 kg). Bodyweight moves and lifts with no history get no weight.
4. **Meals.** Claude also returns its own per-100 g estimate for each food. The
   USDA lookup uses that to reject implausible matches, and falls back to it when
   USDA has nothing. Results are cached by food name. Each day's grams are scaled
   to the kcal and protein targets with two factors, one for protein-dense foods
   (≥30% of kcal from protein, up to 2.2×) and one for the rest (0.6–1.6×), from a
   2×2 solve (`day_factors`, added 2026-10-05; one shared factor left vegan days
   15–23% short on protein, now 98–100%). Rounded to 5 g.
   Days off by more than 10% on kcal, or 15% on protein, go in `targets.warnings`.
5. **Allergies and diet style.** Each food is checked against keyword lists, with
   plant foods named like dairy ("peanut butter", "oat milk") let through.
   Allergy/diet hits, dislikes and short-protein days trigger one retry that
   names the problems. A second allergy/diet hit fails the build with a friendly
   message, and the quota is refunded.

### Progression without AI
The Today card uses double progression. When every set of an exercise reached
`reps_max` last time, the suggestion goes up 2.5 kg (upper body) or 5 kg (lower
body). This is pure code with no AI cost, and it also works for template programs.

## 7. Chat with tools

`POST /plan-ai/chat` replaces `/ai/ask`. The old route stays for TestFlight builds
already installed. The same `ask` quota applies (3 / 15 / 50 per day).

The system prompt and context block are cached. History comes from `ai_messages`.
The tools are strict (`strict: true`) and run in a small manual loop, at most 4 rounds:

| tool | does | limits |
|---|---|---|
| `save_preference` | add a dislike / allergy / injury / note | allergies and injuries need the user's own words, not a guess |
| `swap_meal` | replace one meal in the library, or one day's slot | new meal goes through §6 step 4 |
| `adjust_today` | user ate off-plan: log it (with confirmation) and rescale the rest of today | never below the §8 floor |
| `swap_exercise` | replace an exercise on one day or every day | same muscle group, injury check |
| `change_targets` | raise or lower kcal | within §8 limits, app asks to confirm |
| `rebuild_plan` | start a new plan | counts against the plan quota, app asks to confirm |

Each tool returns the new state to Claude. The app gets an `actions` list, so
it can refresh the plan cards and show an **Undo** chip. Undo restores the
previous `plan` JSON, which is kept per action in `ai_messages.actions`.

*As built (step 5, `services/plan_chat.py`):*
- **No confirmations; Undo instead.** Changes apply right away and the newest
  message that changed something gets an Undo chip. Only that one can be
  undone, since an older snapshot would wipe later changes. Undo is refused
  once the plan has been rebuilt. Undo restores the plan, targets, preferences
  and calorie/protein settings, and deletes food the turn logged.
- **`rebuild_plan` was dropped.** The chat points to the Build button instead,
  which keeps plan builds behind one quota-checked path.
- `adjust_today` logs food only when asked (`log_it`), and rescales today's
  unlogged plan meals by 0.3–1.3× via `plan.today_scale` (read through
  `plan_today.todays_meals`).
- `change_targets` runs the requested numbers through `compute_targets`, so
  §8 clamps apply. It's refused outright for under-18s and health flags. It
  rescales every meal day to the new target.
- `swap_exercise`'s `new_key` is an enum of the user's allowed exercises.
  `swap_meal` rejects allergy/diet hits, gets USDA numbers and sizes the new
  meal to the old one's calories. Saving an allergy or dislike lists the plan
  meals that contain it, so the model swaps them in the same turn.
- Saved history is text only, so each saved reply carries a
  "[Changes made in this turn: ...]" note, and the prompt says those notes are
  accurate. Without them the model "corrected" its own earlier edits.
- Free-text injuries containing a preset ("left elbow") get that preset's
  exclusions.
- Measured on u1: 6-20 s per turn (two calls when a tool runs), about
  $0.01-0.04 a turn.

## 8. Safety

These are hard limits in code. The prompt can't override them, and neither can the chat.
- kcal never below max(BMR, 1,500 men / 1,200 women). Deficit ≤ 25% of TDEE.
  Surplus ≤ 500 kcal.
- Under 18, or any health flag (pregnant or breastfeeding, eating-disorder
  history, diabetes, kidney disease): **no meal plan and no calorie changes.**
  Training plan only, plus a card saying "talk to a doctor or dietitian before
  changing how you eat". `meal_plan_enabled = false`.
- If the chat sees signs of disordered eating (extreme restriction, purging,
  "how do I eat 500 calories"), it doesn't call tools. It gives a supportive answer and points
  to help resources. This is a rule in the system prompt and is also blocked by the
  code limits above.
- Allergies are hard constraints (§6 step 5). Dislikes are soft.

## 9. Plan limits and cost

Measured prices: Sonnet 5, $2 per million tokens in and $10 per million out.

| | cost per call |
|---|---|
| Plan generation, measured on Sonnet 5.5 at high effort: training + meals ~6K in / 12K out, 85 s | ~$0.13 (~$0.19 when it retries) |
| Plan generation, training only (health flag) | ~$0.04 |
| Chat turn with a tool (2 calls, cached context) | ~$0.01–0.03 |
| USDA lookups | free (API key) |

Proposed new `plan` kind in `services/plans.py`:

| | Free | Plus | Pro |
|---|---|---|---|
| Plan builds | 1 (lifetime, to try it) | 1 / week | 3 / week |
| Chat (existing `ask` quota) | 3 / day | 15 / day | 50 / day |
| Template programs (existing) | ✓ | ✓ | ✓ |
| Weekly auto check-in (v2) | – | – | ✓ |

Worst case for Pro, at full use: 12 plans + 50 chats/day ≈ $1.20 + $30 a month.
The chat limit is the real cost risk, as it already is today, and it's unchanged.
A typical Pro user costs about $0.50–1.50 a month.

`Limit.window` needs a third value, `ever`, for the Free lifetime plan.

## 10. App Review (Guideline 1.4.1)

- Wellness wording only: "plan", "suggestion". Never "prescription",
  "treatment" or "diagnosis".
- A disclaimer under the plan and in the onboarding food step.
- "How this plan is built" link to a new `methodology/plans` page citing
  Mifflin-St Jeor, protein ranges (ISSN position stand) and the
  ACSM deficit guidance already cited in onboarding.
- The §8 health-flag gate, so we can tell the reviewer that people with
  medical conditions don't get diet plans.

## 11. API summary

| method | path | |
|---|---|---|
| GET / PUT | `/plan-ai/preferences` | onboarding steps + settings |
| POST | `/plan-ai/plan` | start a build (quota) |
| GET | `/plan-ai/plan` | current plan + status |
| GET | `/plan-ai/today` | today's workout + meals with numbers + progression |
| POST | `/plan-ai/today/log-meal/{meal_id}` | logs via `log-batch` with `source='plan'` |
| POST | `/plan-ai/chat` | chat turn, returns text + actions |
| POST | `/plan-ai/undo/{message_id}` | revert a chat action |
| GET | `/plan-ai/messages` | chat history |

Logging a workout reuses the existing training log screen, opened pre-filled,
which posts to `/training/log-exercise` with `source='plan'`.

## 12. Build order (each step can ship on its own)

All six steps were built 2026-10-02 to 2026-10-04 (commits 883d784 to the
step 6 commit). The methodology page is `lib/methodology.ts` topic `plans`;
keep it in sync with `plan_builder.py` and `plan_today.py`.

1. **Preferences + onboarding.** Migration, `user_preferences`, save `goal`, two
   new steps, settings rows to edit them.
2. **Context builder + better Ask.** `plan_context.py`, saved chat history.
   Ask gets smarter immediately, before plans exist.
3. **Plan generation.** `plan_builder.py`, validation, background build, push,
   `plan` quota.
4. **Pit Crew tab UI.** Rename Ask, plan cards, Today, one-tap logging, progression.
5. **Chat tools + Undo.**
6. **Paywall copy, methodology page, disclaimer.**

## 12b. v2 (2026-10-05)

- **Shopping list** (`services/plan_shopping.py`, `GET /plan-ai/shopping`): code
  only. Next 7 days of meals added up per food, cooked amounts converted to
  what you buy, grouped by aisle; ticks kept on the phone.
- **Prep line**: plan builds and chat swaps return a one-sentence `prep` per meal.
- **Weekly check-in** (`services/plan_checkin.py`, `ai_checkins` table): free
  for everyone. Hourly job catches Sunday 6 pm user-local and pushes; the Pit
  tab also creates it lazily Sunday-Tuesday. Code computes the week's numbers,
  Claude (structured output, ~$0.01) writes the review and up to two
  suggestions (calories / swap_exercise / rebuild), applied through
  `plan_chat.Turn` so the same limits hold. Nothing changes without a tap.
- **Protein-aware scaling** (`day_factors`): see §6 step 4.

## 13. Decisions (2026-10-02)

1. Plan limits in §9: approved.
2. Name: **Pit Crew**, tab label "Pit". Not "Coach" (too close to Google's).
3. The chat may change the calorie target, within §8 limits and with confirmation.
4. Model: all AI features moved to Sonnet 5.5 (`claude-sonnet-5-5`, same price as
   Sonnet 5). `call_claude(thinking=False)` now sends
   `thinking: {"type": "between_tools"}`, because 5.5 rejects `disabled`.
