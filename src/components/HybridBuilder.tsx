import { useMemo } from 'react'
import { copyToClipboard, downloadText } from '../lib/download'
import { serializeValue } from '../lib/parseEnv'
import type { EnvSlotParsed, HybridUniverse } from '../types'

type Props = {
  slots: EnvSlotParsed[]
  /** Slot ids: first has highest priority */
  priorityOrder: string[]
  onReorder: (order: string[]) => void
  enabledSlotIds: string[]
  onEnabledSlotIdsChange: (ids: string[]) => void
  universe: HybridUniverse
  onUniverseChange: (u: HybridUniverse) => void
  keysInOrder: string[]
}

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr]
  const [it] = next.splice(from, 1)
  if (it === undefined) return arr
  next.splice(to, 0, it)
  return next
}

export function HybridBuilder({
  slots,
  priorityOrder,
  onReorder,
  enabledSlotIds,
  onEnabledSlotIdsChange,
  universe,
  onUniverseChange,
  keysInOrder,
}: Props) {
  const merged = useMemo(() => {
    const byId = new Map(slots.map((s) => [s.id, s] as const))
    const enabledSet = new Set(enabledSlotIds)
    const orderedSlots = priorityOrder
      .filter((id) => enabledSet.has(id))
      .map((id) => byId.get(id))
      .filter(Boolean) as EnvSlotParsed[]
    if (orderedSlots.length === 0) return ''

    const keySets = orderedSlots.map((s) => new Set(s.parsed.keyToLastEntry.keys()))
    let keyList: string[]
    if (universe === 'union') {
      const availableKeys = new Set(orderedSlots.flatMap((slot) => [...slot.parsed.keyToLastEntry.keys()]))
      keyList = [...keysInOrder].filter((key) => availableKeys.has(key))
    } else {
      if (orderedSlots.length === 0) {
        keyList = []
      } else {
        const first = keySets[0] ?? new Set<string>()
        const intersection = keySets.slice(1).reduce(
          (acc, set) => new Set([...acc].filter((k) => set.has(k))),
          first
        )
        keyList = [...keysInOrder].filter((k) => intersection.has(k))
      }
    }

    const lines: string[] = []
    for (const key of keyList) {
      let picked: string | undefined
      for (const slot of orderedSlots) {
        const ent = slot.parsed.keyToLastEntry.get(key)
        if (ent) {
          picked = ent.value
          break
        }
      }
      if (picked !== undefined) {
        lines.push(`${key}=${serializeValue(picked)}`)
      }
    }
    return lines.join('\n')
  }, [enabledSlotIds, keysInOrder, priorityOrder, slots, universe])

  const byId = useMemo(() => new Map(slots.map((s) => [s.id, s] as const)), [slots])
  const enabledSet = useMemo(() => new Set(enabledSlotIds), [enabledSlotIds])

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-950">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Hybrid env merge</h2>
      <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
        Build one merged <code className="rounded bg-zinc-200 px-1 py-0.5 text-[0.65rem] dark:bg-zinc-800">.env</code>{' '}
        from several sources: choose union or intersection for which keys appear, enable the envs you want, drag to set
        priority, and we apply a first-wins value for each key—ideal for layering local, staging, and shared defaults.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Keys from:</span>
        <label className="flex cursor-pointer items-center gap-1 text-xs">
          <input
            type="radio"
            name="hybrid-universe"
            checked={universe === 'union'}
            onChange={() => onUniverseChange('union')}
          />
          Union
        </label>
        <label className="flex cursor-pointer items-center gap-1 text-xs">
          <input
            type="radio"
            name="hybrid-universe"
            checked={universe === 'intersection'}
            onChange={() => onUniverseChange('intersection')}
          />
          Intersection
        </label>
      </div>

      <ol className="mt-3 space-y-2">
        {priorityOrder.map((slotId, pos) => {
          const slot = byId.get(slotId)
          const label = slot?.displayName.trim() || `Env ${pos + 1}`
          return (
            <li
              key={`${slotId}-${pos}`}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(pos))
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const from = Number.parseInt(e.dataTransfer.getData('text/plain'), 10)
                if (Number.isNaN(from)) return
                onReorder(moveItem(priorityOrder, from, pos))
              }}
              className={`flex cursor-grab items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm active:cursor-grabbing dark:border-zinc-700 dark:bg-zinc-900/80 ${
                enabledSet.has(slotId) ? '' : 'opacity-50'
              }`}
            >
              <input
                type="checkbox"
                checked={enabledSet.has(slotId)}
                onChange={(event) => {
                  event.stopPropagation()
                  const next = new Set(enabledSlotIds)
                  if (event.target.checked) next.add(slotId)
                  else next.delete(slotId)
                  onEnabledSlotIdsChange(priorityOrder.filter((id) => next.has(id)))
                }}
                onClick={(event) => event.stopPropagation()}
                aria-label={`Include ${label} in hybrid merge`}
              />
              <span className="text-xs font-mono text-zinc-400">{pos + 1}</span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{label}</span>
            </li>
          )
        })}
      </ol>

      <label className="mt-4 block text-xs font-medium text-zinc-600 dark:text-zinc-400">Preview</label>
      <pre className="mt-1 max-h-56 overflow-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
        {merged || 'Select at least one env to build a hybrid.'}
      </pre>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copyToClipboard(merged)}
          disabled={!merged}
          className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-500 disabled:opacity-50"
        >
          Copy hybrid
        </button>
        <button
          type="button"
          onClick={() => downloadText('hybrid.env', merged)}
          disabled={!merged}
          className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Download hybrid
        </button>
      </div>
    </div>
  )
}
