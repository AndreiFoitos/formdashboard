"""
DOTS (Dynamic Objective Team Scoring) — bodyweight-adjusted strength score.

Replaced Wilks as the IPF's primary scoring system in 2019 and is used by the
USAPL / USPA for "best lifter" awards on non-master lifters. It produces a
flatter curve across body weights than Wilks (which over-scored male
middleweights and female super-heavyweights). See the IPF 2020 evaluation:
https://www.powerlifting.sport/fileadmin/ipf/data/ipf-formula/Models-Evaluation-I-2020.pdf

We apply DOTS in two places:
  1. Per-set 1RM-adjusted strength (the standard use)  → `dots_score(total, bw, sex)`
  2. Per-row volume coefficient                         → `dots_coefficient(bw, sex)`
     Used to multiply weekly total volume into a "fair" leaderboard column
     alongside raw kg. Not a published metric — labelled "DOTS-adjusted volume".

Coefficients are the published 5th-degree polynomial. Source:
https://liftvault.com/resources/powerlifting-calculator/
"""

MALE_COEFS = (
    -307.75076,
    24.0900756,
    -0.1918759221,
    0.0007391293,
    -0.000001093,
)
FEMALE_COEFS = (
    -57.96288,
    13.6175032,
    -0.1126655495,
    0.0005158568,
    -0.0000010706,
)


def _denominator(bw_kg: float, sex: str) -> float:
    a, b, c, d, e = FEMALE_COEFS if sex == "female" else MALE_COEFS
    x = bw_kg
    return a + b * x + c * x * x + d * x ** 3 + e * x ** 4


def dots_coefficient(bw_kg: float | None, sex: str | None) -> float | None:
    """
    Returns the DOTS multiplier for a given bodyweight + sex.

    None when we don't have the inputs (missing weight or sex). The leaderboard
    treats None as "exclude from DOTS column" — raw kg still ranks normally.

    Coefficient is clamped to a sane bw range; outside [35, 200] kg the
    polynomial diverges.
    """
    if not bw_kg or not sex:
        return None
    bw = max(35.0, min(float(bw_kg), 200.0))
    denom = _denominator(bw, sex)
    if denom <= 0:
        return None
    return 500.0 / denom


def dots_score(total_lifted_kg: float, bw_kg: float | None, sex: str | None) -> float | None:
    """DOTS = total_lifted × 500 / poly(bw). Standard usage."""
    coef = dots_coefficient(bw_kg, sex)
    if coef is None:
        return None
    return round(total_lifted_kg * coef, 1)
