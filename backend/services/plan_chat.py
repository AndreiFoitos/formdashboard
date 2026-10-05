"""The Pit Crew chat: "ask your data" plus tools that change the plan
(docs/ai-plans-design.md §7).

Claude decides when to call a tool; the code here does the change and keeps
every limit the plan builder keeps: allergies and diet rules on new foods,
equipment and injuries on new exercises (the tool schema's enum), and the §8
calorie limits, with calorie changes off entirely for under-18s and anyone
with a health flag.

Each change records how to reverse it. The app shows an Undo chip on the
latest message that changed something; undo restores the previous plan,
preferences and targets, and deletes any food entry the turn logged.
"""
from __future__ import annotations

import asyncio
import copy
import logging
import uuid
from datetime import date

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.timezone import user_today
from models.ai_message import AiMessage
from models.ai_plan import AiPlan
from models.daily_summary import DailySummary
from models.onboarding import OnboardingBaseline
from models.user import User
from models.user_preference import UserPreference
from services.ai_client import claude_message
from services.ai_features import ASK_SYSTEM_PREFIX, chat_history
from services.plan_builder import (
    ALLERGENS,
    BODYWEIGHT,
    WEEKDAYS,
    _contains,
    _per_100g,
    _scaled,
    _sum,
    allowed_exercises,
    best_one_rms,
    compute_targets,
    food_conflicts,
    meal_plan_allowed,
    start_weight,
    training_days,
)
from services.plan_context import build_context
from services.plan_today import logged_meals, todays_meals

log = logging.getLogger(__name__)

MAX_ROUNDS = 4
NOTE_LEN = 120
ITEM_LEN = 40

CHAT_RULES = """
You are the user's Pit Crew: the planner in the GainRace app. Besides answering questions you can change their plan and preferences with tools.

When to use tools:
- Only change things when the user asks, or states a lasting preference or constraint ("I hate salmon", "my knee hurts on lunges"). A question is not a request.
- "I don't like X": save_preference(dislike) and swap_meal every meal that contains X.
- Allergies and injuries: save only what the user says about themselves. Never infer one. Save injuries as the body part only ("left elbow"), allergies as the food ("peanuts").
- Ate something off-plan: adjust_today with your best macro estimate. Set log_it only if they asked you to log it.
- "Eat less / more": change_targets. It enforces safe limits; if it reports a clamp, tell them.
- A whole new plan: don't try. Tell them to tap "Build a new plan" on the Plan tab.
- swap_meal foods: one plain ingredient each, with its state ("chicken thighs, cooked"), and your per_100g estimate. Match the old meal's slot and roughly its calories; the app rescales grams.

After tools: reply in 1-2 sentences saying what changed. The app shows an Undo button, so don't ask for confirmation first.

The data block and plan show the current state, after any changes made earlier in this chat. The "[Changes made in this turn: ...]" notes on earlier replies are accurate records of what happened. Don't second-guess or "correct" them; only revisit an earlier change if the user asks.
"""


def _plan_summary(row: AiPlan | None, today: date) -> str:
    if row is None or not row.plan:
        return "## Current Pit Crew plan\nNone yet. Plan tools will fail; preferences still save."
    p = row.plan
    lines = ["## Current Pit Crew plan (ids are for tools)"]
    for d in p["training"]["days"]:
        exs = ", ".join(f"{e['key']} {e['sets']}x{e['reps_min']}-{e['reps_max']}" for e in d["exercises"])
        lines.append(f"{WEEKDAYS[d['weekday']]} {d['name']}: {exs}")
    n = p.get("nutrition")
    if n:
        t = n["targets"]
        lines.append(f"Meal targets: {t['kcal']} kcal, {t['protein_g']} g protein")
        for d in n["days"]:
            meals = "; ".join(
                f"{m['id']} {m['slot']} '{m['name']}' {m['totals']['calories']} kcal "
                f"({', '.join(i['food'] for i in m['items'])})"
                for m in d["meals"]
            )
            lines.append(f"{WEEKDAYS[d['weekday']]}: {meals}")
    else:
        lines.append("No meal plan (off for this user).")
    return "\n".join(lines)


def _nullable(t: str) -> dict:
    return {"anyOf": [{"type": t}, {"type": "null"}]}


def _obj(props: dict, desc: str | None = None) -> dict:
    out = {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}
    if desc:
        out["description"] = desc
    return out


def tools(exercise_keys: list[str]) -> list[dict]:
    day = {"type": "string", "enum": [*WEEKDAYS, "all"], "description": "One weekday, or 'all' for every day it appears."}
    item = _obj({
        "food": {"type": "string"},
        "grams": {"type": "number"},
        "per_100g": _obj({k: {"type": "number"} for k in ("kcal", "protein", "carbs", "fat")}),
    })
    return [
        {
            "name": "save_preference",
            "description": "Add or remove a lasting dislike, allergy, injury or note about the user. Future plans and swaps respect it.",
            "strict": True,
            "input_schema": _obj({
                "kind": {"type": "string", "enum": ["dislike", "allergy", "injury", "note"]},
                "value": {"type": "string", "description": "Short, e.g. 'salmon', 'peanuts', 'left knee', 'works night shifts'."},
                "remove": {"type": "boolean"},
            }),
        },
        {
            "name": "swap_meal",
            "description": "Replace one meal of the current plan with a new one, on one weekday or every day it appears.",
            "strict": True,
            "input_schema": _obj({
                "meal_id": {"type": "string"},
                "weekday": day,
                "name": {"type": "string"},
                "prep": {"type": "string", "description": "One short sentence on how to make it; empty if nothing to make."},
                "items": {"type": "array", "items": item},
            }),
        },
        {
            "name": "swap_exercise",
            "description": "Replace an exercise in the training plan, keeping its sets and reps.",
            "strict": True,
            "input_schema": _obj({
                "current_key": {"type": "string"},
                "new_key": {"type": "string", "enum": exercise_keys},
                "weekday": day,
            }),
        },
        {
            "name": "adjust_today",
            "description": "The user ate something off-plan today. Optionally log it, then rescale today's remaining plan meals so the day lands near the target.",
            "strict": True,
            "input_schema": _obj({
                "description": {"type": "string", "description": "What they ate, e.g. '2 slices pepperoni pizza'."},
                "calories": {"type": "integer"},
                "protein_g": {"type": "number"},
                "carbs_g": {"type": "number"},
                "fat_g": {"type": "number"},
                "log_it": {"type": "boolean"},
            }),
        },
        {
            "name": "change_targets",
            "description": "Change the user's daily calorie and/or protein target. Enforces safe limits and rescales the meal plan.",
            "strict": True,
            "input_schema": _obj({"calories": _nullable("integer"), "protein_g": _nullable("integer")}),
        },
    ]


class ToolError(Exception):
    pass


class Turn:
    """State for one chat turn: the rows tools change and the undo log."""

    def __init__(self, user: User, db: AsyncSession, row: AiPlan | None, prefs: UserPreference | None):
        self.user, self.db, self.row, self.prefs = user, db, row, prefs
        self.today = user_today(user.timezone)
        self.actions: list[dict] = []
        self._plan_before = copy.deepcopy(row.plan) if row else None
        self._targets_before = copy.deepcopy(row.targets) if row else None

    def need_plan(self) -> dict:
        if self.row is None or not self.row.plan:
            raise ToolError("There's no plan yet. Tell them to build one on the Plan tab.")
        return self.row.plan

    def need_meals(self) -> dict:
        n = self.need_plan().get("nutrition")
        if not n:
            raise ToolError("This user has no meal plan (it's off for them). Don't change food.")
        return n

    def set_plan(self, plan: dict) -> None:
        self.row.plan = plan  # reassign so the JSONB change is saved

    def record(self, kind: str, summary: str, undo: dict) -> None:
        self.actions.append({"type": kind, "summary": summary, "undo": undo})

    def finish(self) -> list[dict]:
        """Attach the before-state of the plan once, to the first plan change."""
        if self.row is not None and self.row.plan != self._plan_before:
            for a in self.actions:
                if a["type"] in ("swap_meal", "swap_exercise", "adjust_today", "change_targets"):
                    a["undo"]["plan_id"] = str(self.row.id)
                    a["undo"]["plan"] = self._plan_before
                    a["undo"]["targets"] = self._targets_before
                    break
        return self.actions

    # ─── Tools ────────────────────────────────────────────────────────────────

    async def save_preference(self, kind: str, value: str, remove: bool) -> str:
        field = {"dislike": "dislikes", "allergy": "allergies", "injury": "injuries", "note": "notes"}[kind]
        value = " ".join(value.split()).lower()[: NOTE_LEN if kind == "note" else ITEM_LEN]
        if not value:
            raise ToolError("Empty value.")
        if self.prefs is None:
            self.prefs = UserPreference(user_id=self.user.id)
            self.db.add(self.prefs)
        before = list(getattr(self.prefs, field) or [])
        after = [v for v in before if v != value] if remove else (before if value in before else before + [value])
        setattr(self.prefs, field, after)
        label = {"dislike": "dislike", "allergy": "allergy", "injury": "injury", "note": "note"}[kind]
        self.record("save_preference", f"{'Removed' if remove else 'Saved'} {label}: {value}", {"field": field, "value": before})
        msg = f"Saved. {field} is now: {', '.join(after) or 'empty'}."
        if not remove and kind in ("dislike", "allergy") and self.row and (self.row.plan or {}).get("nutrition"):
            words = ALLERGENS.get(value, [value]) if kind == "allergy" else [value]
            hits = sorted({
                f"{m['id']} ({WEEKDAYS[d['weekday']]})"
                for d in self.row.plan["nutrition"]["days"] for m in d["meals"]
                if any(_contains(i["food"], words) for i in m["items"])
            })
            if hits:
                msg += f" Meals in the current plan that contain it: {', '.join(hits)}. Swap them."
        if not remove and kind == "injury":
            msg += " If the plan has exercises that load it, swap them."
        return msg

    async def swap_meal(self, meal_id: str, weekday: str, name: str, items: list[dict], prep: str = "") -> str:
        n = self.need_meals()
        if not items:
            raise ToolError("A meal needs at least one item.")
        hard = [h for i in items for h in food_conflicts(i["food"], self.prefs)[0]]
        if hard:
            raise ToolError("Not allowed: " + "; ".join(hard))
        days = [d for d in n["days"] if (weekday == "all" or d["weekday"] == WEEKDAYS.index(weekday))
                and any(m["id"] == meal_id for m in d["meals"])]
        if not days:
            raise ToolError(f"Meal {meal_id} isn't in the plan{'' if weekday == 'all' else ' on ' + weekday}.")

        async with httpx.AsyncClient(timeout=20) as http:
            found = await asyncio.gather(*(_per_100g(i["food"], i["per_100g"], http) for i in items))
        per100 = {i["food"]: p for i, p in zip(items, found)}
        plan = copy.deepcopy(self.row.plan)
        # A fresh id: reusing the old one ("b_oats") made the model think the
        # oat breakfast was still there.
        new_id = f"m{uuid.uuid4().hex[:6]}"
        old_name = None
        for d in plan["nutrition"]["days"]:
            if d["weekday"] not in {x["weekday"] for x in days}:
                continue
            for k, m in enumerate(d["meals"]):
                if m["id"] != meal_id:
                    continue
                old_name = m["name"]
                base = sum(_scaled(per100[i["food"]], i["grams"])["calories"] for i in items) or 1
                factor = min(max(m["totals"]["calories"] / base, 0.5), 2.0)
                new_items = []
                for i in items:
                    grams = max(5, round(i["grams"] * factor / 5) * 5)
                    p = per100[i["food"]]
                    new_items.append({"food": i["food"], "grams": grams, **_scaled(p, grams),
                                      "source": p["source"], "usda_name": p["usda_name"], "portions": p["portions"]})
                d["meals"][k] = {"id": new_id, "name": name.strip(), "slot": m["slot"], "prep": prep.strip(),
                                 "items": new_items, "totals": _sum(new_items)}
            d["totals"] = _sum([m["totals"] for m in d["meals"]])
        self.set_plan(plan)
        where = "every day" if weekday == "all" else WEEKDAYS[WEEKDAYS.index(weekday)]
        self.record("swap_meal", f"Swapped {old_name} for {name.strip()} ({where})", {})
        return f"Done. New meal id {new_id}."

    async def swap_exercise(self, current_key: str, new_key: str, weekday: str) -> str:
        plan = copy.deepcopy(self.need_plan())
        allowed = await allowed_exercises(self.user, self.prefs, self.db)
        if new_key not in allowed:
            raise ToolError(f"{new_key} isn't allowed for this user (equipment or injury).")
        one_rms = await best_one_rms(self.user, self.today, self.db)
        swapped, old_name = 0, None
        for d in plan["training"]["days"]:
            if weekday != "all" and d["weekday"] != WEEKDAYS.index(weekday):
                continue
            for e in d["exercises"]:
                if e["key"] != current_key:
                    continue
                old_name = e["name"]
                body = new_key in BODYWEIGHT
                e.update({
                    "key": new_key,
                    "name": allowed[new_key][0],
                    "group": allowed[new_key][1],
                    "note": "",
                    "start_weight_kg": None if body else start_weight(one_rms.get(new_key), e["reps_max"]),
                    "basis": "bodyweight" if body else ("e1rm" if one_rms.get(new_key) else "none"),
                })
                swapped += 1
        if not swapped:
            raise ToolError(f"{current_key} isn't in the plan{'' if weekday == 'all' else ' on ' + weekday}.")
        self.set_plan(plan)
        where = "every day" if weekday == "all" else weekday
        self.record("swap_exercise", f"Swapped {old_name} for {allowed[new_key][0]} ({where})", {})
        return f"Done, {swapped} slot(s) changed."

    async def adjust_today(self, description: str, calories: int, protein_g: float, carbs_g: float,
                           fat_g: float, log_it: bool) -> str:
        undo: dict = {}
        parts = []
        if log_it:
            from routers.nutrition import BatchLogRequest, LogNutritionRequest, log_nutrition_batch
            created = await log_nutrition_batch(
                BatchLogRequest(entries=[LogNutritionRequest(
                    calories=max(0, int(calories)), protein_g=max(0.0, protein_g), carbs_g=max(0.0, carbs_g),
                    fat_g=max(0.0, fat_g), meal_name=description.strip()[:60], source="manual",
                )]),
                current_user=self.user, db=self.db,
            )
            if self.row is not None:
                await self.db.refresh(self.row)
            undo["nutrition_log_ids"] = [c["id"] for c in created]
            parts.append(f"Logged {description.strip()} (~{int(calories)} kcal)")

        n = (self.row.plan or {}).get("nutrition") if self.row else None
        if n:
            eaten = (await self.db.execute(
                select(DailySummary.calories_eaten).where(
                    DailySummary.user_id == self.user.id, DailySummary.date == self.today
                )
            )).scalar_one_or_none() or 0
            if not log_it:
                eaten += max(0, int(calories))
            done = await logged_meals(self.user, self.row, self.today, self.db)
            remaining = [m for m in todays_meals(self.row, self.today) if m["id"] not in done]
            left = sum(m["totals"]["calories"] for m in remaining)
            if remaining and left:
                factor = min(max((n["targets"]["kcal"] - eaten) / left, 0.3), 1.3)
                plan = copy.deepcopy(self.row.plan)
                day_scale = {**((plan.get("today_scale") or {}).get(self.today.isoformat()) or {})}
                for m in remaining:
                    day_scale[m["id"]] = round(day_scale.get(m["id"], 1.0) * factor, 3)
                plan["today_scale"] = {self.today.isoformat(): day_scale}  # only today matters
                self.set_plan(plan)
                pct = round((factor - 1) * 100)
                parts.append(f"{'trimmed' if pct < 0 else 'raised'} the rest of today's meals by {abs(pct)}%")
                note = " (that's the most the app will cut; skipping a meal is fine too)" if factor <= 0.3 else ""
            else:
                note = " No plan meals left today to adjust."
        else:
            note = ""
        if not parts:
            return "Nothing to change: no plan meals left today and nothing logged." + note
        summary = "; ".join(parts)
        self.record("adjust_today", summary[0].upper() + summary[1:], undo)
        return f"Done: {summary}.{note}"

    async def change_targets(self, calories: int | None, protein_g: int | None) -> str:
        if not meal_plan_allowed(self.user, self.prefs):
            raise ToolError("Calorie and protein changes are off for this user (age or a health answer). "
                            "Say food changes should go through their doctor or a dietitian.")
        if calories is None and protein_g is None:
            raise ToolError("Give calories and/or protein_g.")
        before = {"calorie_target": self.user.calorie_target, "protein_target_g": self.user.protein_target_g}
        if calories is not None:
            self.user.calorie_target = int(calories)
        if protein_g is not None:
            self.user.protein_target_g = float(protein_g)
        freq = (await self.db.execute(
            select(OnboardingBaseline.training_frequency).where(OnboardingBaseline.user_id == self.user.id)
        )).scalar_one_or_none()
        t = await compute_targets(self.user, self.prefs, training_days(self.prefs, freq), self.today, self.db)
        # compute_targets applied the §8 limits; store the clamped values.
        self.user.calorie_target = int(t["kcal"])
        self.user.protein_target_g = float(t["protein_g"])

        if self.row is not None and (self.row.plan or {}).get("nutrition"):
            plan = copy.deepcopy(self.row.plan)
            n = plan["nutrition"]
            factor = t["kcal"] / n["targets"]["kcal"] if n["targets"]["kcal"] else 1
            for d in n["days"]:
                for m in d["meals"]:
                    for i in m["items"]:
                        f = max(5, round(i["grams"] * factor / 5) * 5) / i["grams"] if i["grams"] else 1
                        for k in ("calories", "protein_g", "carbs_g", "fat_g"):
                            i[k] = round(i[k] * f, 1) if k != "calories" else round(i[k] * f)
                        i["grams"] = round(i["grams"] * f)
                    m["totals"] = _sum(m["items"])
                d["totals"] = _sum([m["totals"] for m in d["meals"]])
            n["targets"] = {k: t[k] for k in ("kcal", "protein_g", "carbs_g", "fat_g")}
            self.set_plan(plan)
            self.row.targets = {**(self.row.targets or {}), **t, "warnings": []}

        bits = []
        if calories is not None:
            bits.append(f"calories {before['calorie_target']} → {self.user.calorie_target} kcal")
        if protein_g is not None:
            bits.append(f"protein {round(before['protein_target_g'] or 0)} → {round(self.user.protein_target_g)} g")
        self.record("change_targets", "Changed " + ", ".join(bits), {"user": before})
        clamp = (" Clamped by the safety limits: " + " ".join(t["notes"])) if t["notes"] else ""
        return f"Done: {', '.join(bits)}.{clamp}"


async def chat_turn(user: User, text: str, db: AsyncSession, days: int) -> tuple[str, list[dict]]:
    """Run one user message through Claude and its tools. Saves nothing to
    ai_messages; the caller does that with the returned actions."""
    row = (await db.execute(
        select(AiPlan)
        .where(AiPlan.user_id == user.id, AiPlan.status == "ready")
        .order_by(AiPlan.created_at.desc())
        .limit(1)
    )).scalar_one_or_none()
    prefs = await db.get(UserPreference, user.id)
    turn = Turn(user, db, row, prefs)
    exercise_keys = sorted(await allowed_exercises(user, prefs, db))

    context = await build_context(user, db, days)
    system = [
        {"type": "text", "text": ASK_SYSTEM_PREFIX + "\n" + CHAT_RULES},
        {"type": "text", "text": context + "\n\n" + _plan_summary(row, turn.today),
         "cache_control": {"type": "ephemeral"}},
    ]
    # Saved history is text only, so tell the model what its earlier turns
    # changed; without this it "corrects" itself and denies its own edits.
    history = []
    for m in await chat_history(user.id, db):
        content = m.content
        if m.actions:
            done = "; ".join(a["summary"] + (" (later undone)" if a.get("undone") else "") for a in m.actions)
            content += f"\n\n[Changes made in this turn: {done}]"
        history.append({"role": m.role, "content": content})
    while history and history[0]["role"] != "user":
        history.pop(0)
    messages = history + [{"role": "user", "content": text}]
    tool_defs = tools(exercise_keys)

    reply = ""
    for _ in range(MAX_ROUNDS):
        msg = await claude_message(
            max_tokens=8000, system=system, messages=messages, tools=tool_defs,
            output_config={"effort": "medium"},
        )
        texts = [b.text for b in msg.content if b.type == "text"]
        if texts:
            reply = "".join(texts).strip()
        uses = [b for b in msg.content if b.type == "tool_use"]
        if msg.stop_reason != "tool_use" or not uses:
            break
        messages.append({"role": "assistant", "content": msg.content})
        results = []
        for b in uses:
            try:
                out = await getattr(turn, b.name)(**b.input)
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": out})
            except ToolError as e:
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": str(e), "is_error": True})
            except Exception:  # noqa: BLE001
                log.exception("chat tool %s failed", b.name)
                results.append({"type": "tool_result", "tool_use_id": b.id,
                                "content": "That change failed on our side. Tell the user to try again.", "is_error": True})
        messages.append({"role": "user", "content": results})

    if not reply and turn.actions:
        reply = "Done: " + "; ".join(a["summary"] for a in turn.actions) + "."
    return reply, turn.finish()


async def undo_actions(user: User, msg: AiMessage, db: AsyncSession) -> None:
    """Reverse one message's changes, newest first. Raises ToolError when the
    plan has been rebuilt since (the snapshot would clobber it)."""
    from routers.nutrition import delete_nutrition
    from fastapi import HTTPException

    actions = msg.actions or []
    prefs = await db.get(UserPreference, user.id)
    for a in reversed(actions):
        u = a.get("undo") or {}
        if "plan" in u:
            row = await db.get(AiPlan, uuid.UUID(u["plan_id"]))
            if row is None or row.status != "ready":
                raise ToolError("Your plan was rebuilt since, so this can't be undone.")
            row.plan = u["plan"]
            row.targets = u["targets"]
        if "field" in u and prefs is not None:
            setattr(prefs, u["field"], u["value"])
        if "user" in u:
            user.calorie_target = u["user"]["calorie_target"]
            user.protein_target_g = u["user"]["protein_target_g"]
        for log_id in u.get("nutrition_log_ids", []):
            try:
                await delete_nutrition(uuid.UUID(log_id), current_user=user, db=db)
            except HTTPException:
                pass
    msg.actions = [{**a, "undone": True} for a in actions]
    await db.commit()
