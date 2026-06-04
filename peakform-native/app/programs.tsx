import { useState } from 'react'
import { View, Text, ScrollView, TouchableOpacity } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { router } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { PROGRAMS, type Program, type ProgramExercise } from '../lib/programs'

// Read-only catalogue of training programs. v1 is structure-only — pick a
// program, see the days, see today's prescriptions; logging stays in the
// regular Training-tab flow. Active-program tracking is a future addition
// (would need a UserActiveProgram table + day-offset math).
//
// Each exercise key matches the training-tab catalogue, so we can route into
// the existing exercise-history view by tapping a row.

function repsLabel(min: number, max: number): string {
  if (min === max) return `${min}`
  return `${min}–${max}`
}

function ExerciseRow({ ex, isLast }: { ex: ProgramExercise; isLast: boolean }) {
  return (
    <View
      className="px-4 py-3 flex-row items-center justify-between"
      style={{
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: '#27272a',
      }}
    >
      <View className="flex-1 pr-2">
        <Text className="text-white text-sm font-medium">
          {humanise(ex.exercise_key)}
        </Text>
        {ex.prescription.notes && (
          <Text className="text-zinc-500 text-xs mt-0.5">{ex.prescription.notes}</Text>
        )}
      </View>
      <Text className="text-zinc-400 text-sm">
        {ex.prescription.sets} × {repsLabel(ex.prescription.reps_min, ex.prescription.reps_max)}
      </Text>
    </View>
  )
}

function humanise(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function ProgramCard({ program }: { program: Program }) {
  const [expandedDay, setExpandedDay] = useState<number | null>(0)

  return (
    <View className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden mb-4">
      <View className="px-4 py-3 border-b border-zinc-800">
        <Text className="text-white text-base font-semibold">{program.name}</Text>
        <Text className="text-zinc-500 text-xs mt-0.5">{program.cadence}</Text>
        <Text className="text-zinc-400 text-xs mt-2 leading-5">{program.summary}</Text>
        <Text className="text-zinc-600 text-[10px] mt-2 italic">{program.citation}</Text>
      </View>

      {program.days.map((day, i) => {
        const open = expandedDay === i
        return (
          <View key={i}>
            <TouchableOpacity
              onPress={() => setExpandedDay(open ? null : i)}
              className="px-4 py-3 flex-row items-center justify-between"
              style={{
                borderBottomWidth: !open && i === program.days.length - 1 ? 0 : 1,
                borderBottomColor: '#27272a',
              }}
            >
              <Text className="text-zinc-300 text-sm font-medium">{day.name}</Text>
              <Text className="text-zinc-500 text-base">{open ? '−' : '+'}</Text>
            </TouchableOpacity>
            {open && (
              <View className="bg-zinc-950">
                {day.exercises.map((ex, j) => (
                  <ExerciseRow
                    key={j}
                    ex={ex}
                    isLast={j === day.exercises.length - 1}
                  />
                ))}
              </View>
            )}
          </View>
        )
      })}
    </View>
  )
}

export default function ProgramsScreen() {
  return (
    <SafeAreaView className="flex-1 bg-black" edges={['top']}>
      <View className="flex-row items-center px-4 pt-2 pb-4">
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} className="-ml-1 pr-4 py-2 flex-row items-center" style={{ gap: 2 }}>
          <ChevronLeft size={22} color="#d4d4d8" strokeWidth={2.25} />
          <Text className="text-zinc-300 text-base font-medium">Back</Text>
        </TouchableOpacity>
        <Text className="text-white text-xl font-bold">Programs</Text>
      </View>

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: 4, paddingBottom: 40 }}
      >
        <Text className="text-zinc-500 text-sm leading-5 mb-5">
          Battle-tested templates from the lifting literature. Pick one, tap a day to see the
          prescription, and log your sets through the regular Training tab. We don't track
          which day you're on — that's on you for now.
        </Text>

        {PROGRAMS.map((p) => (
          <ProgramCard key={p.key} program={p} />
        ))}
      </ScrollView>
    </SafeAreaView>
  )
}
