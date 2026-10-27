"""The user's own split: cleaning, what the builder is told, the check on a
built week, the preferences API field and the chat tool with its undo."""
import asyncio
import uuid

import pytest

from models.ai_message import AiMessage
from models.user import User
from models.user_preference import UserPreference
from routers.plan_ai import PreferencesIn
from services import plan_chat
from services.plan_builder import clean_split, plan_inputs, split_cycle, split_groups, split_problems

EXERCISES = {
    "bench_press": ("Bench Press", "Chest"),
    "barbell_row": ("Barbell Row", "Back"),
    "squat": ("Squat", "Legs"),
    "overhead_press": ("Overhead Press", "Shoulders"),
    "barbell_curl": ("Barbell Curl", "Arms"),
    "plank": ("Plank", "Core"),
}
USER_SPLIT = ["Chest + Back", "Arms + Shoulders", "Legs"]


def day(weekday, *keys, sets=3):
    return {"weekday": weekday, "name": "", "focus": "",
            "exercises": [{"key": k, "sets": sets, "reps_min": 8, "reps_max": 12, "rest_seconds": 90, "note": ""}
                          for k in keys]}


def test_clean_split_trims_caps_and_keeps_repeats():
    assert clean_split(["  Chest  +  Back ", "", "Legs"]) == ["Chest + Back", "Legs"]
    assert clean_split(["Upper", "Lower", "Upper", "Lower"]) == ["Upper", "Lower", "Upper", "Lower"]
    assert clean_split([]) is None
    assert clean_split(["   "]) is None
    assert len(clean_split([f"Day {i}" for i in range(12)])) == 7
    assert len(clean_split(["x" * 80])[0]) == 40


def test_split_groups():
    assert split_groups("Chest + Back") == {"Chest", "Back"}
    assert split_groups("Arms/Shoulders") == {"Arms", "Shoulders"}
    assert split_groups("Push") == {"Chest", "Shoulders", "Arms"}
    assert split_groups("Lower") == {"Legs"}
    assert split_groups("Full body") is None
    assert split_groups("Day A") is None


def test_cycle_repeats_across_days():
    assert split_cycle(USER_SPLIT, 6) == USER_SPLIT * 2
    assert split_cycle(["Upper", "Lower"], 3) == ["Upper", "Lower", "Upper"]


def test_inputs_name_the_split_or_leave_it_open():
    text = plan_inputs(6, 90, "some", "cut", None, EXERCISES, USER_SPLIT)
    assert "Chest + Back -> Arms + Shoulders -> Legs" in text
    assert "Training days in order: Chest + Back, Arms + Shoulders, Legs, Chest + Back" in text
    assert "chosen split: none" in plan_inputs(4, 60, None, None, None, EXERCISES)


def test_matching_week_has_no_problems():
    week = {"days": [
        day("Mon", "bench_press", "barbell_row", "plank"),
        day("Tue", "overhead_press", "barbell_curl"),
        day("Wed", "squat"),
        day("Thu", "bench_press", "barbell_row"),
        day("Fri", "overhead_press", "barbell_curl"),
        day("Sat", "squat", "plank"),
    ]}
    assert split_problems(week, USER_SPLIT, 6, EXERCISES) == []
    assert split_problems(week, None, 6, EXERCISES) == []


def test_upper_lower_week_is_flagged_against_the_users_split():
    week = {"days": [
        day("Mon", "bench_press", "barbell_row", "overhead_press", "barbell_curl"),
        day("Tue", "squat"),
        day("Thu", "bench_press", "barbell_row", "overhead_press"),
        day("Sat", "squat"),
    ]}
    problems = split_problems(week, USER_SPLIT, 6, EXERCISES)
    assert problems[0] == "The week has 4 training days; it needs exactly 6."
    assert any(p.startswith("Mon should be 'Chest + Back'") for p in problems)
    assert any(p.startswith("Tue should be 'Arms + Shoulders'") for p in problems)


def test_preferences_api_cleans_split():
    assert PreferencesIn(split=[" Push ", "Pull", "Legs"]).split == ["Push", "Pull", "Legs"]
    assert PreferencesIn(split=[]).split is None
    body = PreferencesIn.model_validate({"split": None})
    assert "split" in body.model_dump(exclude_unset=True)


class FakeDB:
    def __init__(self, prefs):
        self.prefs = prefs
        self.added = []

    def add(self, obj):
        self.added.append(obj)

    async def get(self, model, key):
        return self.prefs if model is UserPreference else None

    async def commit(self):
        pass


def test_chat_tool_saves_and_undo_restores():
    user = User(id=uuid.uuid4(), timezone="UTC")
    prefs = UserPreference(user_id=user.id, training_days=4, split=None)
    db = FakeDB(prefs)
    turn = plan_chat.Turn(user, db, None, prefs)

    out = asyncio.run(turn.set_training_setup(6, ["Chest + Back", "Arms + Shoulders", "Legs"]))
    assert prefs.training_days == 6
    assert prefs.split == USER_SPLIT
    assert "Build a new plan" in out

    msg = AiMessage(user_id=user.id, role="assistant", content="", actions=turn.finish())
    asyncio.run(plan_chat.undo_actions(user, msg, db))
    assert prefs.training_days == 4
    assert prefs.split is None


def test_chat_tool_rejects_bad_input():
    user = User(id=uuid.uuid4(), timezone="UTC")
    turn = plan_chat.Turn(user, FakeDB(None), None, None)
    with pytest.raises(plan_chat.ToolError):
        asyncio.run(turn.set_training_setup(None, None))
    with pytest.raises(plan_chat.ToolError):
        asyncio.run(turn.set_training_setup(9, None))
