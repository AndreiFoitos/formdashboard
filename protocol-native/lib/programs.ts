// Hardcoded training programs surfaced via app/programs.tsx.
//
// Scope decision: read-only. We show the structure (Push day = these
// exercises × these sets/reps) so a user can pick the day's lifts without
// having to look up the program elsewhere; logging itself still goes through
// the normal Training-tab flow. Active-program tracking is intentionally out
// of scope — it adds a non-trivial schema for a feature whose value is mostly
// the structure itself.
//
// Exercise keys here MUST match the keys in protocol-native/app/(tabs)/training.tsx
// GROUPS so tapping an exercise can navigate / pre-fill the log modal later.

export interface ProgramSet {
  sets: number
  reps_min: number
  reps_max: number
  notes?: string
}

export interface ProgramExercise {
  exercise_key: string
  prescription: ProgramSet
}

export interface ProgramDay {
  name: string
  exercises: ProgramExercise[]
}

export interface Program {
  key: string
  name: string
  cadence: string
  summary: string
  citation: string
  days: ProgramDay[]
}

export const PROGRAMS: Program[] = [
  {
    key: 'ppl',
    name: 'Push / Pull / Legs',
    cadence: '3–6 days/week',
    summary:
      'Classic hypertrophy split — each day hits one motor pattern. Rotate Push → Pull → Legs, repeating as many times per week as recovery allows.',
    citation: "Modern bodybuilding standard (Schoenfeld et al., 2016 — training-frequency review)",
    days: [
      {
        name: 'Push',
        exercises: [
          { exercise_key: 'bench_press',      prescription: { sets: 4, reps_min: 6, reps_max: 8 } },
          { exercise_key: 'incline_db_press', prescription: { sets: 3, reps_min: 8, reps_max: 10 } },
          { exercise_key: 'overhead_press',   prescription: { sets: 3, reps_min: 6, reps_max: 8 } },
          { exercise_key: 'lateral_raise',    prescription: { sets: 4, reps_min: 12, reps_max: 15 } },
          { exercise_key: 'tricep_pushdown',  prescription: { sets: 3, reps_min: 10, reps_max: 12 } },
          { exercise_key: 'tricep_extension', prescription: { sets: 3, reps_min: 8, reps_max: 10 } },
        ],
      },
      {
        name: 'Pull',
        exercises: [
          { exercise_key: 'deadlift',     prescription: { sets: 3, reps_min: 4, reps_max: 6, notes: 'Heavy. Skip if recent.' } },
          { exercise_key: 'pull_up',      prescription: { sets: 4, reps_min: 6, reps_max: 10 } },
          { exercise_key: 'barbell_row',  prescription: { sets: 3, reps_min: 6, reps_max: 8 } },
          { exercise_key: 'cable_row',    prescription: { sets: 3, reps_min: 10, reps_max: 12 } },
          { exercise_key: 'face_pull',    prescription: { sets: 4, reps_min: 12, reps_max: 15 } },
          { exercise_key: 'bicep_curl',   prescription: { sets: 3, reps_min: 8, reps_max: 12 } },
          { exercise_key: 'hammer_curl',  prescription: { sets: 3, reps_min: 10, reps_max: 12 } },
        ],
      },
      {
        name: 'Legs',
        exercises: [
          { exercise_key: 'squat',           prescription: { sets: 4, reps_min: 5, reps_max: 8 } },
          { exercise_key: 'romanian_dl',     prescription: { sets: 3, reps_min: 6, reps_max: 8 } },
          { exercise_key: 'leg_press',       prescription: { sets: 3, reps_min: 10, reps_max: 12 } },
          { exercise_key: 'leg_curl',        prescription: { sets: 3, reps_min: 10, reps_max: 12 } },
          { exercise_key: 'leg_extension',   prescription: { sets: 3, reps_min: 12, reps_max: 15 } },
          { exercise_key: 'calf_raise',      prescription: { sets: 4, reps_min: 10, reps_max: 15 } },
        ],
      },
    ],
  },
  {
    key: 'five_three_one_bbb',
    name: "Wendler 5/3/1 — Boring But Big",
    cadence: '4 days/week',
    summary:
      "Four-week mesocycle on the big lifts. Working sets at 5+/3+/1+ at 85/90/95% of training max, followed by 5×10 'Boring But Big' at 50–60% for hypertrophy. Add 2.5/5 kg to the training max each cycle.",
    citation: 'Wendler, J. (2009). 5/3/1: The Simplest and Most Effective Training System.',
    days: [
      {
        name: 'Day 1 — Bench',
        exercises: [
          { exercise_key: 'bench_press',     prescription: { sets: 3, reps_min: 1, reps_max: 5, notes: '5+, 3+, 1+ of training max' } },
          { exercise_key: 'bench_press',     prescription: { sets: 5, reps_min: 10, reps_max: 10, notes: 'BBB @ 50–60% TM' } },
          { exercise_key: 'barbell_row',     prescription: { sets: 5, reps_min: 10, reps_max: 10 } },
          { exercise_key: 'tricep_pushdown', prescription: { sets: 3, reps_min: 10, reps_max: 15 } },
        ],
      },
      {
        name: 'Day 2 — Squat',
        exercises: [
          { exercise_key: 'squat',           prescription: { sets: 3, reps_min: 1, reps_max: 5, notes: '5+, 3+, 1+ of TM' } },
          { exercise_key: 'squat',           prescription: { sets: 5, reps_min: 10, reps_max: 10, notes: 'BBB @ 50–60% TM' } },
          { exercise_key: 'leg_curl',        prescription: { sets: 5, reps_min: 10, reps_max: 10 } },
          { exercise_key: 'plank',           prescription: { sets: 3, reps_min: 1, reps_max: 1, notes: '45–60s' } },
        ],
      },
      {
        name: 'Day 3 — Overhead',
        exercises: [
          { exercise_key: 'overhead_press',     prescription: { sets: 3, reps_min: 1, reps_max: 5, notes: '5+, 3+, 1+ of TM' } },
          { exercise_key: 'overhead_press',     prescription: { sets: 5, reps_min: 10, reps_max: 10, notes: 'BBB @ 50–60% TM' } },
          { exercise_key: 'pull_up',            prescription: { sets: 5, reps_min: 10, reps_max: 10 } },
          { exercise_key: 'bicep_curl',         prescription: { sets: 3, reps_min: 10, reps_max: 15 } },
        ],
      },
      {
        name: 'Day 4 — Deadlift',
        exercises: [
          { exercise_key: 'deadlift',           prescription: { sets: 3, reps_min: 1, reps_max: 5, notes: '5+, 3+, 1+ of TM' } },
          { exercise_key: 'deadlift',           prescription: { sets: 5, reps_min: 10, reps_max: 10, notes: 'BBB @ 50–60% TM' } },
          { exercise_key: 'hip_thrust',         prescription: { sets: 5, reps_min: 10, reps_max: 10 } },
          { exercise_key: 'hanging_leg_raise',  prescription: { sets: 3, reps_min: 8, reps_max: 12 } },
        ],
      },
    ],
  },
  {
    key: 'starting_strength',
    name: 'Starting Strength',
    cadence: '3 days/week (A / B alternating)',
    summary:
      "Linear-progression novice barbell program. Workout A and B alternate; add weight to every working lift every session until you stall. Designed by Mark Rippetoe; the gold standard for the first 3–6 months of barbell training.",
    citation: 'Rippetoe, M. & Kilgore, L. Starting Strength: Basic Barbell Training.',
    days: [
      {
        name: 'Workout A',
        exercises: [
          { exercise_key: 'squat',         prescription: { sets: 3, reps_min: 5, reps_max: 5 } },
          { exercise_key: 'bench_press',   prescription: { sets: 3, reps_min: 5, reps_max: 5 } },
          { exercise_key: 'deadlift',      prescription: { sets: 1, reps_min: 5, reps_max: 5 } },
        ],
      },
      {
        name: 'Workout B',
        exercises: [
          { exercise_key: 'squat',           prescription: { sets: 3, reps_min: 5, reps_max: 5 } },
          { exercise_key: 'overhead_press',  prescription: { sets: 3, reps_min: 5, reps_max: 5 } },
          { exercise_key: 'deadlift',        prescription: { sets: 1, reps_min: 5, reps_max: 5 } },
        ],
      },
    ],
  },
]
