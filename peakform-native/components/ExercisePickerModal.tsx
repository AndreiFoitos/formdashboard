import { useMemo, useState } from 'react'
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Search, X } from 'lucide-react-native'
import { api } from '../api/client'
import { useProgressionOverview } from '../hooks/useProgression'
import { GROUPS, searchKey } from '../lib/exercises'
import { hapticSelection, hapticSuccess } from '../lib/haptics'
import { useUnits } from '../lib/units'
import { colors } from '../theme/tokens'

// Shared by the Training tab and the Pit Crew plan editor.

export interface CustomExerciseRow {
  id: string
  key: string
  name: string
  group_name: string
  created_at: string
}

/** ↑ kg when an exercise is ready for more weight, Stalled when stuck. */
function ProgressBadge({
  info,
}: {
  info?: { ready_for_weight: boolean; stalled: boolean }
}) {
  const u = useUnits()
  if (!info || (!info.ready_for_weight && !info.stalled)) return null
  const colour = info.stalled ? colors.warning : colors.success
  return (
    <View className="rounded-full px-2 py-1" style={{ borderCurve: 'continuous', backgroundColor: `${colour}22` }}>
      <Text className="text-caption font-semibold" style={{ color: colour }}>
        {info.stalled ? 'Stalled' : `↑ ${u.weightUnit}`}
      </Text>
    </View>
  )
}

/** Days each exercise was logged on, from the last 500 sets. Shares the
 *  Training tab's history query, so it costs nothing extra. */
function useExerciseFrequency(): Record<string, number> {
  const { data } = useQuery<{ type: string; date: string }[]>({
    queryKey: ['training-history'],
    queryFn: () => api.get('/training/history?limit=500').then(r => r.data),
    staleTime: 60 * 1000,
  })
  return useMemo(() => {
    const days: Record<string, Set<string>> = {}
    for (const l of data ?? []) (days[l.type] ??= new Set()).add(l.date)
    return Object.fromEntries(Object.entries(days).map(([k, v]) => [k, v.size]))
  }, [data])
}

type PickerItem = { key: string; name: string; group: string; custom: boolean }

function PickerRow({
  item,
  colour,
  info,
  onPick,
}: {
  item: PickerItem
  /** Group dot, shown where the list mixes groups. */
  colour?: string
  info?: { ready_for_weight: boolean; stalled: boolean }
  onPick: (key: string) => void
}) {
  return (
    <TouchableOpacity
      onPress={() => { hapticSelection(); onPick(item.key) }}
      className="px-4 py-3 rounded-xl bg-surface border border-divider flex-row items-center justify-between" style={{ borderCurve: 'continuous' }}
    >
      <View className="flex-row items-center gap-2 flex-1 pr-2">
        {colour && <View className="w-1.5 h-1.5 rounded-full" style={{ borderCurve: 'continuous', backgroundColor: colour }} />}
        <Text className="text-text text-footnote flex-shrink" numberOfLines={1}>{item.name}</Text>
      </View>
      <View className="flex-row items-center gap-2">
        <ProgressBadge info={info} />
        {item.custom && <Text className="text-text-subtle text-caption">Custom</Text>}
      </View>
    </TouchableOpacity>
  )
}

const GROUP_COLOUR: Record<string, string> = Object.fromEntries(GROUPS.map(g => [g.name, g.colour]))

export function ExercisePickerModal({
  onPick,
  onClose,
  filterGroup,
}: {
  onPick: (key: string) => void
  onClose: () => void
  /**
   * When set, the picker lists exercises (hardcoded + custom) of this muscle
   * group. Drives the tile-tap flow on the Training tab. Search still looks
   * through everything.
   */
  filterGroup?: string
}) {
  const qc = useQueryClient()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  // If we're filtering to one group, default the new-custom-exercise group
  // to that group so the user doesn't have to re-pick.
  const [newGroup, setNewGroup] = useState<string>(filterGroup ?? 'Chest')
  const { data: progress } = useProgressionOverview()
  const freq = useExerciseFrequency()

  const customQ = useQuery<CustomExerciseRow[]>({
    queryKey: ['custom-exercises'],
    queryFn: () => api.get('/training/custom-exercises').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  })

  const createMutation = useMutation({
    mutationFn: (body: { name: string; group_name: string }) =>
      api.post('/training/custom-exercises', body).then((r) => r.data),
    onSuccess: () => {
      hapticSuccess()
      qc.invalidateQueries({ queryKey: ['custom-exercises'] })
      setNewName('')
      setCreating(false)
      setQuery('')
    },
  })

  // Every exercise once, customs folded into their group ('Other' if none).
  const items = useMemo<PickerItem[]>(() => [
    ...GROUPS.flatMap(g => g.exercises.map(e => ({ key: e.key, name: e.name, group: g.name, custom: false }))),
    ...(customQ.data ?? []).map(c => ({ key: c.key, name: c.name, group: c.group_name, custom: true })),
  ], [customQ.data])

  // Most logged first; the catalogue order breaks ties (sort is stable).
  const byFreq = (a: PickerItem, b: PickerItem) => (freq[b.key] ?? 0) - (freq[a.key] ?? 0)

  const q = searchKey(query)
  const results = useMemo(() => {
    if (!q) return []
    const words = q.split(' ')
    return items.filter(i => {
      const name = searchKey(i.name)
      return words.every(w => name.includes(w))
    }).sort(byFreq)
  }, [q, items, freq])

  const inScope = items.filter(i => !filterGroup || i.group === filterGroup)
  const top = inScope.filter(i => (freq[i.key] ?? 0) > 0).sort(byFreq).slice(0, 5)
  const sections = [
    ...GROUPS.map(g => g.name),
    'Other',
  ].filter(g => !filterGroup || g === filterGroup)

  function startCustom(name = '') {
    setNewName(name)
    setCreating(true)
  }

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View className="flex-1 bg-surface">
        <View className="items-center pt-3 pb-2">
          <View className="w-10 h-1 bg-border rounded-full" style={{ borderCurve: 'continuous' }} />
        </View>
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="text-text font-semibold">
            {filterGroup ? `Pick ${filterGroup.toLowerCase()} exercise` : 'Pick exercise'}
          </Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            className="w-10 h-10 -mr-1 rounded-full bg-surface-raised border border-border items-center justify-center" style={{ borderCurve: 'continuous' }}
          >
            <X size={20} color={colors.text} strokeWidth={2.25} />
          </TouchableOpacity>
        </View>
        <View className="px-4 pb-3 border-b border-divider">
          <View
            className="flex-row items-center bg-surface-raised border border-border rounded-md px-3"
            style={{ borderCurve: 'continuous', minHeight: 44 }}
          >
            <Search size={16} color={colors['text-subtle']} strokeWidth={2} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={`Search ${items.length} exercises`}
              placeholderTextColor={colors['text-subtle']}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              clearButtonMode="while-editing"
              className="flex-1 py-3 px-2 text-text text-footnote"
            />
          </View>
        </View>
        <ScrollView showsVerticalScrollIndicator={false} showsHorizontalScrollIndicator={false}
          className="flex-1 px-4 pt-4"
          contentContainerClassName="pb-6"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          automaticallyAdjustKeyboardInsets
        >
          {/* Custom-exercise creation block. Expands inline rather than
              launching another modal. */}
          {creating ? (
            <View className="bg-surface-raised border border-border rounded-xl p-3 mb-4" style={{ borderCurve: 'continuous' }}>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="Exercise name"
                placeholderTextColor={colors['text-subtle']}
                maxLength={80}
                className="bg-surface-raised border border-border rounded-md px-3 py-3 text-text text-footnote mb-2" style={{ borderCurve: 'continuous' }}
              />
              <ScrollView showsVerticalScrollIndicator={false} horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2" keyboardShouldPersistTaps="handled">
                {[...GROUPS.map(g => ({ name: g.name, colour: g.colour })), { name: 'Other', colour: colors.text }].map((g) => {
                  const active = newGroup === g.name
                  return (
                    <TouchableOpacity
                      key={g.name}
                      onPress={() => setNewGroup(g.name)}
                      className="px-3 py-2 rounded-full border"
                      style={{
                        borderCurve: 'continuous',
                        backgroundColor: active ? g.colour : colors.surface,
                        borderColor: active ? g.colour : colors.border,
                      }}
                    >
                      <Text
                        className="text-caption font-medium"
                        style={{ color: active ? colors.bg : colors['text-muted'] }}
                      >
                        {g.name}
                      </Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
              <View className="flex-row mt-3 gap-2">
                <TouchableOpacity
                  onPress={() => { setCreating(false); setNewName('') }}
                  className="flex-1 py-2 rounded-md bg-surface-raised border border-border items-center" style={{ borderCurve: 'continuous' }}
                >
                  <Text className="text-text-muted text-footnote">Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => {
                    const trimmed = newName.trim()
                    if (!trimmed) return
                    createMutation.mutate({ name: trimmed, group_name: newGroup })
                  }}
                  disabled={!newName.trim() || createMutation.isPending}
                  className="flex-1 py-2 rounded-md bg-accent items-center"
                  style={{ borderCurve: 'continuous', opacity: !newName.trim() || createMutation.isPending ? 0.4 : 1 }}
                >
                  {createMutation.isPending ? (
                    <ActivityIndicator color={colors['on-accent']} />
                  ) : (
                    <Text className="text-on-accent text-footnote font-semibold">Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          ) : q ? null : (
            <TouchableOpacity
              onPress={() => startCustom()}
              className="rounded-xl border border-border bg-surface-raised px-4 py-3 mb-4" style={{ borderCurve: 'continuous' }}
            >
              <Text className="text-text text-footnote font-medium">+ New custom exercise</Text>
              <Text className="text-text-subtle text-caption mt-1">
                Add a movement we don't have in the catalogue.
              </Text>
            </TouchableOpacity>
          )}

          {q ? (
            // Search: one flat list across every group, most logged first.
            <View className="gap-2">
              {results.map(i => (
                <PickerRow
                  key={i.key}
                  item={i}
                  colour={GROUP_COLOUR[i.group] ?? colors.muscle.other}
                  info={progress?.[i.key]}
                  onPick={onPick}
                />
              ))}
              {results.length === 0 && !creating && (
                <TouchableOpacity
                  onPress={() => startCustom(query.trim())}
                  className="rounded-xl border border-border bg-surface-raised px-4 py-3" style={{ borderCurve: 'continuous' }}
                >
                  <Text className="text-text text-footnote font-medium">No match. Add “{query.trim()}”</Text>
                  <Text className="text-text-subtle text-caption mt-1">Save it as a custom exercise.</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              {top.length > 0 && (
                <View className="mb-4">
                  <Text className="text-text-subtle text-caption mb-2">Your most logged</Text>
                  <View className="gap-2">
                    {top.map(i => (
                      <PickerRow
                        key={i.key}
                        item={i}
                        colour={filterGroup ? undefined : GROUP_COLOUR[i.group] ?? colors.muscle.other}
                        info={progress?.[i.key]}
                        onPick={onPick}
                      />
                    ))}
                  </View>
                </View>
              )}

              {sections.map(group => {
                const rows = items.filter(i => i.group === group).sort(byFreq)
                if (!rows.length) return null
                return (
                  <View key={group} className="mb-4">
                    {!filterGroup && (
                      <View className="flex-row items-center gap-2 mb-2">
                        <View className="w-1.5 h-1.5 rounded-full" style={{ borderCurve: 'continuous', backgroundColor: GROUP_COLOUR[group] ?? colors.muscle.other }} />
                        <Text className="text-text-subtle text-caption">{group}</Text>
                      </View>
                    )}
                    <View className="gap-2">
                      {rows.map(i => (
                        <PickerRow key={i.key} item={i} info={progress?.[i.key]} onPick={onPick} />
                      ))}
                    </View>
                  </View>
                )
              })}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  )
}
