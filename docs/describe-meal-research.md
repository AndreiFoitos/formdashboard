# Describe a meal (text / voice): research and options

Status: decided 2026-11-17. All nine recommendations below were accepted
(D1 B, D2 B, D3 B, D4 C, D5 A, D6 A, D7 A, D8 A + C, D9 B). Built on branch
`feat/describe-meal`. Every design choice lists the options, what the
research says, and the pick.

**Revised after the eval (§7), same day, on the 30-dish results:**
- D1: keep the USDA-grounded pipeline (it tied direct).
- D7: **Haiku 5.5** for every call ($0.0012 vs $0.017, accuracy tied).
- D2: the total range doubles its low side and is never narrower than
  −20% / +10% (~80% coverage, up from 57%).
- D6: describing gets **its own allowance**: Free 5, Plus 20, Pro 50 a day.

## 1. The feature

The user types or says what they ate, for example:

> "I had a lil bit of olive oil, with around 200-300 mashed potatos made with
> milk and butter, and like 200 g of stake"

Claude turns it into foods with amounts, calories and macros. The user reviews
the result, adjusts portions and logs it. Ideally the result shows how sure it
is (a range or a confidence).

## 2. Has it been done?

Yes. The big trackers all have some version, and they fall into three designs.

| App | What it does | How it works |
|---|---|---|
| MyFitnessPal "Voice Log" (Dec 2024, Premium, US English only) | Say what you ate, get suggested matches | Speech to text, then matches the words to database entries. A competitor's test says it handles multi-item meals and stated portions poorly (competitor claim). |
| Lose It! "Say It!" (2025) | Describe food in plain words | Matches the description to its 63M-item database. The company says AI logging users log 3.5x faster (company data). |
| MacroFactor "AI Describe" (2025) | Describe a meal by voice or text; also "Photo & Text" | An LLM interprets ingredients and quantities, then uses research-grade entries from their own food database instead of trusting the LLM's numbers. This is the same design as our photo scan. |
| SnapCalorie voice notes | Describe by voice | Assumes average portions when you don't say an amount. |
| Nutrola and many small "voice macro" apps | Describe by voice/text | Mostly LLM-first. Nutrola's own test: about 92% accurate with specific quantities, 78% with moderate detail, 54% with vague input (vendor numbers, method unclear). |

What this means for us:

- **Design 1: speech to search** (MFP, Lose It). This is close to what we already
  have with search. It is weak on "a bit of oil, 200-300 g of mash".
- **Design 2: LLM parses the text, a food database supplies the numbers**
  (MacroFactor). Our photo pipeline already works this way.
- **Design 3: the LLM answers everything** (many small apps). This is the
  simplest design, but the numbers can't be traced to a source and can shift
  between runs.
- None of the big apps shows a calorie range. Most show one number and let
  the user edit it. A range would set us apart, but nobody has shown that
  users want one.
- How vague the input is drives most of the error. Every source says this.

## 3. How accurate can it be?

**Text studies**

- **NutriBench** (ICLR 2025, the main text benchmark) has 11,857 human-checked
  meal descriptions (v2: 15,617, from 24 countries) labelled with carbs,
  protein, fat and kcal. The paper only scores carbs.
  - Best result: GPT-4o with chain-of-thought had 66.8% of estimates within
    7.5 g of carbs (MAE 8.6 g).
  - On the same 72 questions, nutritionists without lookup tools scored 42%
    and GPT-4o scored 61%. The model took about 2 minutes, the nutritionists 43.
  - Asking the model to reason first (chain-of-thought) helped on average
    (43% to 47% across 12 models).
  - Adding food-database retrieval (RAG) did **not** consistently help.
  - Vague household amounts ("a bowl") were harder than grams for most models.
  - Meals with more items had more error. Reasoning first reduced that.
- **Peruvian lunches** (2025, open Gemma-3 27B model): calories matched only
  45% of the time. The authors say this is not yet good enough for consumer
  apps. This used a small open model, not a frontier one.

**Photo studies, for comparison**

- **ChatGPT-5 on meal photos** (Nutrients, Nov 2025): adding a written list of
  ingredients to the photo clearly improved calorie and macro estimates. This
  supports adding a "describe" note to photo scans too (decision D9).
- **Open-KNEAD** (arXiv, 2026, photos): modern models estimating directly now
  match or beat retrieval pipelines on **total** calories. Grounding each item
  in FNDDS still gave better **portions** and a per-item record you can check.

**Our own photo numbers** (Nutrition5k eval, Sonnet 5.5): median error about
34–36%, MAE about 102 kcal, about $0.011 and about 11 s per scan. The model
**overestimates portions by about 1.29x** from photos. Text avoids most of that
when the user says the amount ("200 g of steak").

**Confidence numbers from the model can't be trusted.** Studies of LLMs that
state their own confidence find them overconfident, with answers bunching at
"90%" or "100%". No study tests calorie ranges specifically.

**Bottom line:** text should be at least as accurate as photos when users give
amounts, and worse when they're vague. The right way to show uncertainty is a
range based on the ambiguity in the user's own words, not a "% confident"
figure from the model.

## 4. What the feature needs

**Backend**
- A new endpoint, `POST /nutrition/estimate/text {text}`. It returns the same
  shape as the photo endpoint plus a range per item: `grams_low/high`,
  `kcal_low/high`, `assumption`, and `totals_low/high`.
- Reuse `services/nutrition_estimate.py`: the USDA candidate search and the
  density check carry over unchanged. Two text-only variants are needed: the
  parse prompt (instead of the vision prompt) and the pick prompt (without
  the photo).
- Use structured output (`call_claude_json`, JSON schema) instead of the
  photo pipeline's "parse JSON from text". The schema stops a half-formed reply.
- Guards:
  - Cap input at about 500 characters.
  - Charge the quota and refund it on failure, as `consume_scan` /
    `refund_scan` do now.
  - The global daily AI cap already applies.
  - Handle refusals.
  - The text is user data, not instructions. The model has no tools, so a
    "prompt injection" can only change that user's own estimate.
- Food names: the parse step turns names into plain English USDA-style names
  for the search ("stake" becomes "beef steak, cooked"). The user's own words
  stay as the display name.
- Branded or restaurant foods ("a Big Mac"): FNDDS covers many of these.
  `services/openfoodfacts.py` is there for packaged foods. The Claude fallback
  covers the rest, the same as photos.

**App**
- A new `nutrition-describe` screen: a multi-line text box, two or three
  example sentences, and a Send button. Loading shows the same stage labels
  as photo scans.
- Reuse `nutrition-confirm.tsx`. Each item becomes its own log row (source
  `text_item`, like `photo_item`), so `/nutrition/frequent` keeps working. The
  meal builder already accepts confirm-screen items (`for=meal`).
- Entry points: a "Describe" button next to "Snap photo" and "Scan barcode" in
  the log sheet and in Build a meal.

**Legal / store**
- `gainrace-legal/privacy.html`: the Anthropic section lists what we send.
  Add "meal descriptions you type or dictate".
- Voice through the keyboard needs no new permission. An in-app mic button
  needs microphone + speech-recognition permission strings, a new native build
  (not an OTA update) and updated App Store privacy answers. `app.json`
  currently has `microphonePermission: false`.
- The Claude API takes text, images and PDFs, but not audio. Voice therefore
  has to become text on the phone (or through another paid service) first.

**Cost and speed** (estimates, to be measured in the eval)
- The pipeline is the same as photos minus the image tokens. That's about
  $0.004–0.006 per describe on Sonnet 5.5 (photo: $0.011) and about 6–9 s.
  An LLM-only answer would be about 3–5 s.
- On Haiku 5.5 ($0.10 / $0.50 per MTok, 20x cheaper than Sonnet) it would be
  well under $0.001. Haiku 5.5 has never been tested on our food tasks.
  Haiku 4.5 lost accuracy on the photo pick step.

## 5. Decisions

### D1. Where the numbers come from
| Option | Pros | Cons |
|---|---|---|
| **A. LLM only:** Claude returns grams, kcal and macros directly | One call. Fastest (~3–5 s), cheapest, least code. The research says modern models are competitive on totals. | Numbers can't be traced to a source and may change between runs. No USDA badge. Differs from how photo scans work. |
| **B. Reuse the photo pipeline:** parse the text, find FNDDS candidates, pick the entry and portion | Reuses ~80% of the existing code. Numbers come from USDA and match photo scans. Grams the user states go straight through. A range is easy to compute (see D2). | Two calls, ~6–9 s. Can still mis-match a food (the density check catches most). |
| **C. A third-party NLP API** (Nutritionix `/natural/nutrients`, FatSecret NLP) | Built for exactly this. | Paid: FatSecret NLP is a paid add-on, contact-sales only, and Nutritionix's paid tiers are reportedly hundreds of dollars a month. Both clash with the no-paid-hosting rule. Weaker on loose wording. Adds a new vendor to the privacy policy. |

**Recommendation: B**, with A run as a baseline in the eval. If A ties B on
accuracy, A is simpler and faster and we could switch.

### D2. How to show uncertainty
| Option | What the user sees | Notes |
|---|---|---|
| A. One number + the ½×–2× buttons (like photo) | "820 kcal" | Simplest and consistent. Ignores the "200-300" the user typed. |
| **B. A range from the user's own words + the database** | "≈ 820 kcal · likely 660–1,030" | The low/high grams come from the text ("200-300" gives 200/300; "a bit of oil" gives 1 tsp–1 tbsp). The kcal spread comes from the plausible USDA matches (sirloin vs ribeye). The range can be explained and the eval can check it. |
| C. The model's "% confident" | "80% confident" | Research says these figures are overconfident and bunch at 90–100%. Not recommended. (The current photo chip, "X% confident", is really "share of items matched to USDA".) |
| D. A range from measured error | "±25%" | Honest on average but the same for every meal. Needs eval data first. |

**Recommendation: B.** The eval checks that the true value falls inside the
range about 80% of the time. The range is shown only on the total and inside
each item's editor, so the screen stays light.

### D3. Adjusting portions
| Option | Notes |
|---|---|
| A. Keep the global ½×–2× buttons only | Already built. Can't fix one item. |
| **B. Per-item amount editing (tap an item: grams or a slider within its range) + global buttons** | Needed most for text, where one item ("200-300 mash") is the vague one. |
| C. B + a "fix it" box ("it was 2 tbsp of oil") that re-runs Claude | Most natural, but every fix is another paid call. Does it count against the quota? |

**Recommendation: B now, C later** if users ask for it.

### D4. When something is missing ("a lil bit", steak cut, raw or cooked)
| Option | Notes |
|---|---|
| A. Assume quietly | Fast, but the user can't see why it says 820. |
| B. Ask a follow-up question first | Accurate, but adds a step and a round trip. Some apps do it for vague input. |
| **C. Assume, and show the assumption on the item** ("assumed: 1 tsp", "assumed cooked weight, sirloin"), tap to change | No extra step. Fits the "keep logging minimal" rule. |

**Recommendation: C.**

### D5. Voice
| Option | Notes |
|---|---|
| **A. The iOS keyboard's dictation mic** | Zero code, no permissions, no new build, free, works in any text box. A hint under the box: "tap 🎤 on the keyboard to talk". |
| B. An in-app mic button with on-device speech recognition (`expo-speech-recognition`, Apple's speech engine) | Nicer (hold to talk, live transcript), still free. Needs a native build, two permission prompts and App Store privacy updates. |
| C. Record audio and send it to a cloud speech-to-text service | Costs per minute, adds a new vendor, slower. Claude can't take audio itself. |

**Recommendation: A for v1**, B later if people use voice a lot.

### D6. Quota
Current food-scan limits: Free 1/day, Plus 4/day, Pro 12/day. The pricing
policy charges only for per-use AI cost, so describing should be metered like
scans.

| Option | Notes |
|---|---|
| **A. Share the food-scan quota** (one bucket of "AI food logs") | No new limits or paywall copy. Cost-safe. A free user who photographs breakfast can't describe lunch. |
| B. A separate, bigger describe quota (e.g. Free 3, Plus 10, Pro 30) | Possible because text is about half the cost of a photo. Needs `plans.py`, paywall and ScanQuota changes. On Sonnet, a heavy free user costs about $0.45/month. |
| C. Unmetered | Breaks the "meter per-use AI" rule and risks abuse. |

**Recommendation: A for v1.** Re-open this if the eval shows Haiku 5.5 is
accurate enough, because then B costs almost nothing.

### D7. Model
| Option | Cost per describe (est.) | Notes |
|---|---|---|
| **A. Sonnet 5.5** (what all AI uses now) | ~$0.005 | Proven on photos. |
| B. Haiku 5.5 | <$0.001 | 20x cheaper, new and untested here. Haiku 4.5 lost on the photo pick step, but text-only is an easier task. |
| C. Opus 5.5 | ~$0.010 | Likely the most accurate. Use it in the eval as the ceiling. |

**Recommendation: launch on A; include B and C in the eval.**

### D8. How we test it before shipping
| Option | Notes |
|---|---|
| **A. Text versions of the Nutrition5k dishes we already use** | The eval script already loads each dish's weighed ingredients. Claude writes casual descriptions at three levels of vagueness. Same 100 dishes, so text and photo compare directly. License CC BY 4.0. |
| B. NutriBench | 15.6k real descriptions with kcal. **License CC BY-NC-SA (non-commercial)**, so using it to tune a paid app is risky. |
| **C. 20–30 of your own weighed meals, described the way you'd say them** | Small but the most realistic. |
| D. No eval, ship and watch | Fastest, but we'd be guessing between A/B in D1 and the models in D7. |

**Recommendation: A + C.** Measure kcal MAE and whether the range contains the
truth, for D1-A vs D1-B and D7 A/B/C. Estimated cost $1–3 per full run. I'd
ask before spending it.

### D9. Also add a text note to photo scans?
MacroFactor has "Photo & Text", and the ChatGPT-5 study found that adding
ingredient text improves photo estimates (hidden oil, butter, sauce).

| Option | Notes |
|---|---|
| A. Build it in the same branch | Small once the text parse exists. |
| **B. Later, as its own change** | Keeps this branch focused, and the eval can measure it separately. |
| C. No | |

**Recommendation: B.**

## 6. The example, run through the recommended design (illustrative numbers)

| Item (as typed) | Read as | Amount | Assumption shown | kcal (likely range) |
|---|---|---|---|---|
| "a lil bit of olive oil" | olive oil | ~7 g (5–14 g) | assumed ½ tbsp | ~60 (45–125) |
| "200-300 mashed potatos made with milk and butter" | mashed potatoes, made with milk and butter | 250 g (200–300 g) | assumed grams | ~275 (220–330) |
| "200 g of stake" | beef steak, cooked | 200 g | assumed cooked weight, sirloin-type cut | ~480 (400–580) |
| **Total** | | | | **≈ 820 (660–1,030)** |

At runtime the real per-100 g values come from USDA. The steak row shows why
the assumption matters: the cut and raw-vs-cooked weight together move it by
more than 150 kcal.

## 7. Eval results (partial, 2026-11-17)

`scripts/eval_food_text.py`, Nutrition5k plates written as text at three
levels of detail. The Anthropic credit balance ran out after $2.50, so this
covers **30 of 100 dishes** (88 paired cases per condition). Rerun the same
command to finish: failed calls are retried.

| Condition | Level | kcal MAE | Median error | Bias | Truth in range | $/estimate | s |
|---|---|---|---|---|---|---|---|
| grounded (Sonnet 5.5) | exact | 31 | 10.5% | +7% | 77% | 0.0176 | 8.8 |
| | rough | 55 | 10.6% | +18% | 55% | 0.0172 | 8.0 |
| | vague | 168 | 40.5% | +46% | 38% | 0.0162 | 8.1 |
| | **all** | **84** | 16.3% | +24% | 57% | **0.0170** | 8.3 |
| direct (Sonnet 5.5) | all | 87 | 15.1% | +24% | 58% | 0.0100 | 5.7 |
| grounded (Haiku 5.5) | all | 82 | 15.9% | +20% | 56% | **0.0012** | 8.8 |
| *photo pipeline, same 30 plates* | | *117* | *31.5%* | *+24%* | | *~0.011* | *~11* |

- **Direct vs grounded:** +3 kcal (95% CI −6 to +12). No difference.
- **Haiku vs Sonnet, grounded:** −3 kcal (95% CI −15 to +10). No difference
  at 1/14 of the cost.
- **With amounts, text is 2–4x more accurate than a photo.** With vague
  words only it is worse than a photo, and it overestimates by +46%.
- **Ranges are too narrow on the low side.** When the truth fell outside
  the range, it was below it 30 times and above it 8 times. Coverage is
  57% against an 80% target.
- **Sonnet costs more than measured before.** At $0.017, a Sonnet describe
  costs more than a photo scan ($0.011), mostly from the pick step reading
  every candidate's portion list.

## 8. Sources

- MyFitnessPal Voice Logging help: https://support.myfitnesspal.com/hc/en-us/articles/30332897072269-Voice-Logging
- MyFitnessPal / Tribe AI case study: https://www.tribe.ai/case-studies/myfitnesspal
- Lose It! AI logging press release (2025): https://www.newswire.com/news/lose-it-finds-ai-powered-logging-boosts-weight-loss-success-and-22557702
- MacroFactor AI logging (Apr 2025): https://macrofactor.com/mm-april-2025/ and food logger: https://macrofactorapp.com/?p=4543
- Nutrola voice accuracy test (vendor): https://nutrola.app/en/blog/can-you-track-calories-accurately-with-just-your-voice-tested
- SnapCalorie App Store listing: https://apps.apple.com/us/app/-/id1574239307
- NutriBench paper (ICLR 2025): https://arxiv.org/html/2407.12843v6 and dataset: https://huggingface.co/datasets/dongx1997/NutriBench
- Peruvian meals LLM study: https://www.medrxiv.org/content/10.1101/2025.10.21.25338310v1.full.pdf
- ChatGPT-5 image + context study: https://pubmed.ncbi.nlm.nih.gov/41305663/
- Open-KNEAD: https://arxiv.org/abs/2607.12911
- Verbalized confidence calibration: https://arxiv.org/pdf/2306.13063 and https://arxiv.org/pdf/2412.14737
- FatSecret NLP API and editions: https://platform.fatsecret.com/docs/v1/natural.language.processing and https://platform.fatsecret.com/api-editions
- Nutritionix API overview: https://apis.io/providers/nutritionix/
- expo-speech-recognition: https://github.com/jamsch/expo-speech-recognition
- Claude vision / input types: https://platform.claude.com/docs/en/build-with-claude/vision
