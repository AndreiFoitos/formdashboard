# App Review Information (App Store Connect)

Where: App Store Connect → GainRace → the version → **App Review Information**.

## Sign-in information

- **Sign-in required:** on
- **User name:** `review@gainrace.com`
- **Password:** in `backend/scripts/_seed_review_account.py` (git-ignored, local only)

Re-run that script the day you submit so the account's logs end on the current date:

```
venv/Scripts/python.exe scripts/_seed_review_account.py
```

(from `backend/`). It recreates only the review account: Pro plan, 30 days of logs, 15 friends, Pit preferences and a built Pit plan.

## Contact information

Your name, phone and email (support@gainrace.com is fine for email).

## Notes (paste everything between the lines, about 2,300 characters)

---

Thank you for reviewing GainRace.

DEMO ACCOUNT
Enter the email and password above on the sign-in screen and tap "Sign in". The account is on the Pro plan, has 30 days of logged training, food, water and caffeine, is friends with 15 test users (so the Weekly Race, leaderboard and weekly recap have data), and already has a Pit plan built. Purchases in review use the sandbox.

WHAT THE APP DOES
GainRace is a fitness habit tracker. Users log training, food, water and caffeine; the app turns those logs into a daily "Form Score" and a weekly race against friends. Formulas and sources for every score are listed in Settings → How GainRace works.

THE PIT (AI TRAINING AND MEAL PLANS) - GUIDELINE 1.4.1
The Pit tab gives general fitness and nutrition guidance. It is not a medical app and does not diagnose or treat any condition.
- Claude (Anthropic) only chooses exercises and foods. Every number the user sees (calorie and macro targets, starting weights, grams per meal) is calculated by our code from published formulas (Mifflin-St Jeor, USDA FoodData Central), not by the AI.
- Hard calorie floors are enforced in code: never below 1,500 kcal (men) / 1,200 kcal (women), never below the user's estimated BMR, and never below 75% of their maintenance calories. The plan chat cannot go below these either.
- Meal plans and calorie changes are switched off for users under 18 and for anyone who reports pregnancy, an eating disorder, diabetes or kidney disease. Those users get training plans only and are told to speak to a doctor or dietitian.
- Allergies are hard constraints: a plan containing an allergen is rejected and rebuilt.
- The Pit screen and the methodology page (Settings → How GainRace works → Pit Crew plans) state that plans are general fitness guidance, not medical advice.

CAMERA
The camera is used only when the user taps to photograph a meal (calorie estimate), scan a barcode, or take body photos for a body-fat estimate. Photos are sent for analysis and not stored by us.

SUBSCRIPTIONS
Plus and Pro (monthly/yearly) raise the limits on AI features (food scans, body-fat scans, Pit plans), the friends cap, long-range trends and data export. Logging, the Form Score, streaks and the friends race are free. Restore purchases: paywall and Settings. Terms: https://gainrace.com/terms

ACCOUNT DELETION
Settings → Delete account (guideline 5.1.1(v)). It also revokes Sign in with Apple.

---
