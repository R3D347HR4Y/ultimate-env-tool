import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ComparisonMatrix } from './components/ComparisonMatrix'
import { EnvSlotPanel } from './components/EnvSlotPanel'
import { HybridBuilder } from './components/HybridBuilder'
import { Legend } from './components/Legend'
import { EnablePersistenceDialog, UnlockDialog } from './components/PersistenceDialogs'
import { downloadFile } from './lib/download'
import { indicesFromMask, summarizeValueRelations } from './lib/presence'
import type { PresenceMask, ValueRelationSummary } from './lib/presence'
import { isValidEnvKeyName, parseEnv, renameEnvKey, upsertEnvValue } from './lib/parseEnv'
import {
  encryptSnapshot,
  clearPersistedStorage,
  hasPersistedCipher,
  writePersistedRaw,
  type AppStateSnapshot,
} from './lib/persistStorage'
import {
  DEFAULT_SLOT_COUNT,
  MAX_ENVS,
  type EnvSlot,
  type EnvSlotParsed,
  type HybridUniverse,
  emptySlot,
  defaultEnvColor,
  normalizeEnvSlot,
} from './types'
import { seo } from './seo'

function uid(): string {
  return crypto.randomUUID?.() ?? `id-${Math.random().toString(36).slice(2)}`
}

function discoveryKeyOrder(slots: EnvSlotParsed[]): string[] {
  const seen = new Set<string>()
  const keys: string[] = []
  for (const slot of slots) {
    for (const e of slot.parsed.entries) {
      if (e.type === 'kv' && !seen.has(e.key)) {
        seen.add(e.key)
        keys.push(e.key)
      }
    }
  }
  return keys
}

function unionKeys(slots: EnvSlotParsed[]): Set<string> {
  const s = new Set<string>()
  for (const slot of slots) {
    for (const k of slot.parsed.keyToLastEntry.keys()) s.add(k)
  }
  return s
}

function rowMaskForKey(slots: EnvSlotParsed[], key: string): PresenceMask {
  let m = 0
  slots.forEach((s, i) => {
    if (s.parsed.keyToLastEntry.has(key)) m |= 1 << i
  })
  return m
}

function normalizeSlots(slotsIn: EnvSlot[]): EnvSlot[] {
  const trimmed = slotsIn.slice(0, MAX_ENVS).map((slot, index) => normalizeEnvSlot(slot, index))
  if (trimmed.length >= DEFAULT_SLOT_COUNT) return trimmed
  const next = [...trimmed]
  while (next.length < DEFAULT_SLOT_COUNT) {
    next.push(emptySlot(uid(), next.length))
  }
  return next
}

type LegendFilterOption = {
  id: string
  text: string
  envIndices?: number[]
}

const MIN_KEY_COLUMN_WIDTH = 50
const MAX_KEY_COLUMN_WIDTH = 420
const MIN_VALUE_COLUMN_WIDTH = 180
const MAX_VALUE_COLUMN_WIDTH = 1200

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

function defaultQuarterTableWidth(useFullWidth = false): number {
  if (typeof window === 'undefined') return 320
  const viewportWidth = window.innerWidth
  const appContainerWidth = useFullWidth
    ? Math.max(320, viewportWidth - 32)
    : Math.min(1280, Math.max(320, viewportWidth - 32))
  return Math.round(appContainerWidth / 4)
}

function sharedFilterId(mask: number): string {
  return `shared:${mask}`
}

function sharedMaskFromFilterId(id: string): number | null {
  if (!id.startsWith('shared:')) return null
  const value = Number.parseInt(id.slice('shared:'.length), 10)
  return Number.isNaN(value) ? null : value
}

function differentMaskFromFilterId(id: string): number | null {
  if (!id.startsWith('different:')) return null
  const value = Number.parseInt(id.slice('different:'.length), 10)
  return Number.isNaN(value) ? null : value
}

function allSubsetMasks(indices: number[], minSize = 2): number[] {
  const out: number[] = []
  const n = indices.length
  for (let bits = 0; bits < 1 << n; bits++) {
    const chosen: number[] = []
    for (let i = 0; i < n; i++) {
      if (bits & (1 << i)) chosen.push(indices[i]!)
    }
    if (chosen.length >= minSize) out.push(chosen.reduce((m, i) => m | (1 << i), 0))
  }
  return out
}

export default function App() {
  const cryptoKeyRef = useRef<CryptoKey | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const [bootstrapped, setBootstrapped] = useState(() => !hasPersistedCipher())
  const [persistenceActive, setPersistenceActive] = useState(false)
  const [enableDialogOpen, setEnableDialogOpen] = useState(false)
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const [slots, setSlots] = useState<EnvSlot[]>(() =>
    Array.from({ length: DEFAULT_SLOT_COUNT }, (_, i) => emptySlot(uid(), i))
  )
  const [alignKeys, setAlignKeys] = useState(true)
  const [sortAsc, setSortAsc] = useState(true)
  const [hideEnvContents, setHideEnvContents] = useState(true)
  const [hideTableContents, setHideTableContents] = useState(true)
  const [useFullWidth, setUseFullWidth] = useState(false)
  const [legendCollapsed, setLegendCollapsed] = useState(false)
  const [legendFilterIds, setLegendFilterIds] = useState<Set<string>>(() => new Set())
  const [keyColumnWidth, setKeyColumnWidth] = useState(() =>
    clamp(defaultQuarterTableWidth(), MIN_KEY_COLUMN_WIDTH, MAX_KEY_COLUMN_WIDTH)
  )
  const [valueColumnWidth, setValueColumnWidth] = useState(() =>
    clamp(defaultQuarterTableWidth(), MIN_VALUE_COLUMN_WIDTH, MAX_VALUE_COLUMN_WIDTH)
  )
  const [priorityOrder, setPriorityOrder] = useState<string[]>([])
  const [hybridEnabledIds, setHybridEnabledIds] = useState<string[] | null>(null)
  const [hybridUniverse, setHybridUniverse] = useState<HybridUniverse>('union')

  const parsedSlots: EnvSlotParsed[] = useMemo(
    () => slots.map((s) => ({ ...s, parsed: parseEnv(s.rawText) })),
    [slots]
  )

  const hybridOrder = useMemo(() => {
    const ids = slots.map((s) => s.id)
    const base = priorityOrder.length > 0 ? priorityOrder : ids
    const next = base.filter((id) => ids.includes(id))
    for (const id of ids) {
      if (!next.includes(id)) next.push(id)
    }
    return next
  }, [slots, priorityOrder])

  const activeHybridEnabledIds = useMemo(() => {
    const ids = slots.map((s) => s.id)
    if (hybridEnabledIds === null) return ids
    return hybridEnabledIds.filter((id) => ids.includes(id))
  }, [hybridEnabledIds, slots])

  const keysInOrder = useMemo(() => {
    const union = unionKeys(parsedSlots)
    const discovery = discoveryKeyOrder(parsedSlots)
    const restKeys = [...union].filter((k) => !discovery.includes(k))
    return sortAsc
      ? [...union].sort((a, b) => a.localeCompare(b))
      : [...discovery, ...restKeys]
  }, [parsedSlots, sortAsc])

  const rowMaskByKey = useMemo(() => {
    const m = new Map<string, PresenceMask>()
    for (const key of keysInOrder) {
      m.set(key, rowMaskForKey(parsedSlots, key))
    }
    return m
  }, [keysInOrder, parsedSlots])

  const valueSummaryByKey = useMemo(() => {
    const m = new Map<string, ValueRelationSummary>()
    for (const key of keysInOrder) {
      m.set(key, summarizeValueRelations(parsedSlots, key))
    }
    return m
  }, [keysInOrder, parsedSlots])

  const legendFilterOptions = useMemo(() => {
    const options: LegendFilterOption[] = [{ id: 'all-match', text: 'Same value on all envs' }]
    const sharedMasks = new Set<number>()
    const differentMasks = new Set<number>()
    for (const summary of valueSummaryByKey.values()) {
      for (const mask of summary.sharedValueMasks) {
        const count = indicesFromMask(mask, parsedSlots.length).length
        if (count >= 2 && count < parsedSlots.length) sharedMasks.add(mask)
      }
      for (const mask of allSubsetMasks(summary.uniqueValueSlotIndices, 2)) {
        const count = indicesFromMask(mask, parsedSlots.length).length
        if (count >= 2 && count < parsedSlots.length) differentMasks.add(mask)
      }
    }
    for (const mask of [...sharedMasks].sort((a, b) => a - b)) {
      options.push({
        id: sharedFilterId(mask),
        text: 'Same value on',
        envIndices: indicesFromMask(mask, parsedSlots.length),
      })
    }
    options.push({ id: 'all-different', text: 'Different value on all envs' })
    for (const mask of [...differentMasks].sort((a, b) => a - b)) {
      options.push({
        id: `different:${mask}`,
        text: 'Different value on',
        envIndices: indicesFromMask(mask, parsedSlots.length),
      })
    }
    parsedSlots.forEach((_, index) => {
      options.push({
        id: `unique:${index}`,
        text: 'Values unique to',
        envIndices: [index],
      })
    })
    parsedSlots.forEach((_, index) => {
      options.push({
        id: `missing:${index}`,
        text: 'No value on',
        envIndices: [index],
      })
    })
    return options
  }, [valueSummaryByKey, parsedSlots])

  const activeLegendFilterIds = useMemo(() => {
    if (legendFilterIds.size === 0) return legendFilterIds
    const validIds = new Set(legendFilterOptions.map((option) => option.id))
    return new Set([...legendFilterIds].filter((id) => validIds.has(id)))
  }, [legendFilterIds, legendFilterOptions])

  const keysForMatrix = useMemo(() => {
    if (activeLegendFilterIds.size === 0) return keysInOrder
    return keysInOrder.filter((key) => {
      const summary = valueSummaryByKey.get(key)
      if (!summary) return false

      for (const filterId of activeLegendFilterIds) {
        if (filterId === 'all-match' && summary.allMatch) return true
        if (filterId === 'all-different' && summary.allDifferent) return true
        if (filterId.startsWith('unique:')) {
          const idx = Number.parseInt(filterId.slice('unique:'.length), 10)
          if (!Number.isNaN(idx) && summary.uniqueValueSlotIndices.includes(idx)) return true
        }
        if (filterId.startsWith('missing:')) {
          const idx = Number.parseInt(filterId.slice('missing:'.length), 10)
          if (!Number.isNaN(idx) && summary.missingSlotIndices.includes(idx)) return true
        }
        const sharedMask = sharedMaskFromFilterId(filterId)
        if (sharedMask !== null) {
          const matchesShared = summary.sharedValueMasks.some((mask) => (mask & sharedMask) === sharedMask)
          const rowMask = rowMaskByKey.get(key) ?? 0
          if (matchesShared || (summary.allMatch && (rowMask & sharedMask) === sharedMask)) {
            return true
          }
        }
        const differentMask = differentMaskFromFilterId(filterId)
        if (differentMask !== null) {
          const uniqueMask = summary.uniqueValueSlotIndices.reduce((mask, idx) => mask | (1 << idx), 0)
          if ((uniqueMask & differentMask) === differentMask) return true
        }
      }
      return false
    })
  }, [activeLegendFilterIds, keysInOrder, rowMaskByKey, valueSummaryByKey])

  const buildSnapshot = useCallback((): AppStateSnapshot => {
    return {
      v: 1,
      slots,
      alignKeys,
      sortAsc,
      hideEnvContents,
      hideTableContents,
      useFullWidth,
      legendCollapsed,
      priorityOrder,
      hybridEnabledIds: hybridEnabledIds ?? undefined,
      hybridUniverse,
      legendFilterIds:
        activeLegendFilterIds.size > 0 ? [...activeLegendFilterIds] : undefined,
      tableWidths: {
        keyColumnWidth,
        valueColumnWidth,
      },
    }
  }, [
    slots,
    alignKeys,
    sortAsc,
    hideEnvContents,
    hideTableContents,
    useFullWidth,
    legendCollapsed,
    priorityOrder,
    hybridEnabledIds,
    hybridUniverse,
    activeLegendFilterIds,
    keyColumnWidth,
    valueColumnWidth,
  ])

  const applySnapshot = useCallback((snap: AppStateSnapshot) => {
    const nextUseFullWidth = snap.useFullWidth ?? false
    const defaultWidth = defaultQuarterTableWidth(nextUseFullWidth)
    setSlots(normalizeSlots(snap.slots))
    setAlignKeys(snap.alignKeys)
    setSortAsc(snap.sortAsc)
    setHideEnvContents(snap.hideEnvContents ?? true)
    setHideTableContents(snap.hideTableContents ?? true)
    setUseFullWidth(nextUseFullWidth)
    setLegendCollapsed(snap.legendCollapsed)
    setPriorityOrder(Array.isArray(snap.priorityOrder) ? snap.priorityOrder : [])
    setHybridEnabledIds(Array.isArray(snap.hybridEnabledIds) ? snap.hybridEnabledIds : null)
    setHybridUniverse(snap.hybridUniverse === 'intersection' ? 'intersection' : 'union')
    setLegendFilterIds(snap.legendFilterIds?.length ? new Set(snap.legendFilterIds) : new Set())
    setKeyColumnWidth(
      clamp(snap.tableWidths?.keyColumnWidth ?? defaultWidth, MIN_KEY_COLUMN_WIDTH, MAX_KEY_COLUMN_WIDTH)
    )
    setValueColumnWidth(
      clamp(
        snap.tableWidths?.valueColumnWidth ?? defaultWidth,
        MIN_VALUE_COLUMN_WIDTH,
        MAX_VALUE_COLUMN_WIDTH
      )
    )
  }, [])

  const handleUnlock = useCallback(
    (key: CryptoKey, snapshot: AppStateSnapshot, rawCipher: string) => {
      cryptoKeyRef.current = key
      writePersistedRaw(rawCipher)
      applySnapshot(snapshot)
      setPersistenceActive(true)
      setBootstrapped(true)
      setUnlockDialogOpen(false)
    },
    [applySnapshot]
  )

  const handlePurgeFromUnlock = useCallback(() => {
    setBootstrapped(true)
    setUnlockDialogOpen(false)
  }, [])

  const handleEnablePersist = useCallback(
    async (key: CryptoKey) => {
      cryptoKeyRef.current = key
      setPersistenceActive(true)
      const snap = buildSnapshot()
      const enc = await encryptSnapshot(key, snap)
      writePersistedRaw(enc)
    },
    [buildSnapshot]
  )

  const purgeEncryptedStorage = useCallback(() => {
    if (
      !confirm(
        'Remove the encrypted backup from this browser and forget the in-memory key? Your current editor contents are not cleared.'
      )
    ) {
      return
    }
    clearPersistedStorage()
    cryptoKeyRef.current = null
    setPersistenceActive(false)
  }, [])

  useEffect(() => {
    if (!persistenceActive || !bootstrapped) return
    const key = cryptoKeyRef.current
    if (!key) return
    const snap = buildSnapshot()
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const enc = await encryptSnapshot(key, snap)
          writePersistedRaw(enc)
        } catch {
          /* ignore failed autosave */
        }
      })()
    }, 450)
    return () => clearTimeout(t)
  }, [bootstrapped, persistenceActive, buildSnapshot])

  const updateSlot = (id: string, patch: Partial<EnvSlot>) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  const addSlot = () => {
    setSlots((prev) => {
      if (prev.length >= MAX_ENVS) return prev
      const nextSlot = emptySlot(uid(), prev.length)
      setHybridEnabledIds((current) => (current === null ? null : [...current, nextSlot.id]))
      return [...prev, nextSlot]
    })
  }

  const removeSlot = (id: string) => {
    setSlots((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((s) => s.id !== id)
    })
    setHybridEnabledIds((prev) => (prev === null ? null : prev.filter((slotId) => slotId !== id)))
  }

  const clearAll = () => {
    setSlots((prev) =>
      prev.map((s, i) => ({
        ...emptySlot(s.id, i),
        id: s.id,
        displayName: s.displayName,
        color: s.color,
      }))
    )
  }

  const updateKeyColumnWidth = useCallback((width: number) => {
    setKeyColumnWidth(clamp(Math.round(width), MIN_KEY_COLUMN_WIDTH, MAX_KEY_COLUMN_WIDTH))
  }, [])

  const updateValueColumnWidth = useCallback((width: number) => {
    setValueColumnWidth(clamp(Math.round(width), MIN_VALUE_COLUMN_WIDTH, MAX_VALUE_COLUMN_WIDTH))
  }, [])

  const updateCellValue = useCallback((slotId: string, key: string, value: string) => {
    setSlots((prev) =>
      prev.map((slot) =>
        slot.id === slotId ? { ...slot, rawText: upsertEnvValue(slot.rawText, key, value) } : slot
      )
    )
  }, [])

  const showToast = useCallback((message: string) => {
    setToastMessage(message)
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current)
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null)
      toastTimerRef.current = null
    }, 2200)
  }, [])

  const exportEncryptedArchive = useCallback(async () => {
    const key = cryptoKeyRef.current
    if (!key) {
      showToast('Unlock persistence before exporting an archive')
      return
    }
    const snapshot = buildSnapshot()
    const encrypted = await encryptSnapshot(key, snapshot)
    writePersistedRaw(encrypted)
    downloadFile('ultimate-env-tool.encrypted-archive.json', encrypted, 'application/json;charset=utf-8')
    showToast('Encrypted archive exported')
  }, [buildSnapshot, showToast])

  const renameKeyAcrossEnvs = useCallback(
    (fromKey: string, toKey: string) => {
      const nextKey = toKey.trim()
      if (!nextKey || !isValidEnvKeyName(nextKey)) {
        showToast('Key names must start with a letter or underscore')
        return false
      }
      setSlots((prev) =>
        prev.map((slot) => ({
          ...slot,
          rawText: renameEnvKey(slot.rawText, fromKey, nextKey),
        }))
      )
      return true
    },
    [showToast]
  )

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    document.title = seo.documentTitle
  }, [])

  const hasAnyContent = parsedSlots.some((s) => s.rawText.trim().length > 0)

  const showUnlock = unlockDialogOpen || (!bootstrapped && hasPersistedCipher())
  const layoutWidthClass = useFullWidth ? 'max-w-none' : 'max-w-7xl'

  return (
    <div className="min-h-svh bg-zinc-100 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <UnlockDialog
        open={showUnlock}
        onUnlocked={handleUnlock}
        onPurgeStorage={handlePurgeFromUnlock}
        allowClose={unlockDialogOpen}
        onClose={() => setUnlockDialogOpen(false)}
      />
      <EnablePersistenceDialog
        open={enableDialogOpen}
        onClose={() => setEnableDialogOpen(false)}
        onEnabled={(key) => handleEnablePersist(key)}
      />

      <header className="border-b border-zinc-200 bg-white/90 px-4 py-6 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
        <div className={`mx-auto flex ${layoutWidthClass} flex-col gap-4 sm:flex-row sm:items-start sm:justify-between`}>
          <div className="min-w-0 text-left">
            <h1
              id="site-title"
              className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
            >
              {seo.siteName}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
              Compare, diff, and merge multiple <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-800">.env</code>{' '}
              (dotenv) files entirely in your browser: paste or drop local, dev, and staging secrets into columns, align key sets, read the matrix, and build a hybrid merge. Everything stays client-side unless you enable persistence—then AES-256-GCM encrypts backups in this browser and the key only lives in this tab until you close it.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 self-end sm:self-start">
            {persistenceActive && (
              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-medium text-emerald-800 dark:text-emerald-300">
                Persistence on
              </span>
            )}
            {bootstrapped && !persistenceActive && !showUnlock && (
              <button
                type="button"
                onClick={() => setUnlockDialogOpen(true)}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Import encrypted archive
              </button>
            )}
            {bootstrapped && !persistenceActive && !showUnlock && (
              <button
                type="button"
                onClick={() => setEnableDialogOpen(true)}
                className="rounded-lg border border-violet-300 bg-violet-50 px-3 py-2 text-sm font-medium text-violet-900 hover:bg-violet-100 dark:border-violet-700 dark:bg-violet-950/50 dark:text-violet-100 dark:hover:bg-violet-900/40"
              >
                Enable persistence
              </button>
            )}
            {bootstrapped && persistenceActive && (
              <button
                type="button"
                onClick={() => void exportEncryptedArchive()}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                Export encrypted archive
              </button>
            )}
            {bootstrapped && persistenceActive && (
              <button
                type="button"
                onClick={purgeEncryptedStorage}
                className="rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-medium text-rose-800 hover:bg-rose-50 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/60"
              >
                Purge encrypted storage
              </button>
            )}
          </div>
        </div>
      </header>

      <main
        className={`mx-auto ${layoutWidthClass} space-y-8 px-4 py-8 ${showUnlock ? 'pointer-events-none opacity-40' : ''}`}
        aria-labelledby="site-title"
        aria-hidden={showUnlock}
      >
        <section className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={alignKeys}
                onChange={(e) => setAlignKeys(e.target.checked)}
                disabled={showUnlock}
              />
              Align key sets (show empty cells)
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sortAsc}
                onChange={(e) => setSortAsc(e.target.checked)}
                disabled={showUnlock}
              />
              Sort keys A–Z
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={useFullWidth}
                onChange={(e) => setUseFullWidth(e.target.checked)}
                disabled={showUnlock}
              />
              Use full width
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hideEnvContents}
                onChange={(e) => setHideEnvContents(e.target.checked)}
                disabled={showUnlock}
              />
              Hide env contents
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hideTableContents}
                onChange={(e) => setHideTableContents(e.target.checked)}
                disabled={showUnlock}
              />
              Hide table contents
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={addSlot}
              disabled={slots.length >= MAX_ENVS || showUnlock}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Add env ({slots.length}/{MAX_ENVS})
            </button>
            <button
              type="button"
              onClick={clearAll}
              disabled={showUnlock}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              Clear all slots
            </button>
          </div>
        </section>

        <section className="space-y-3" aria-label="Environment file columns">
          <div>
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Environment columns</h2>
            <p className="mt-1 max-w-3xl text-xs text-zinc-600 dark:text-zinc-400">
              Paste, type, or drop each dotenv file into its own column. Name and color slots to tell local, staging, and
              production configs apart while you work with sensitive values privately on your machine.
            </p>
          </div>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch">
          {parsedSlots.map((slot, index) => (
            <EnvSlotPanel
              key={slot.id}
              slot={slot}
              parsed={slot.parsed}
              slotIndex={index}
              onNameChange={(displayName) => updateSlot(slot.id, { displayName })}
              onColorChange={(color) => updateSlot(slot.id, { color })}
              onResetColor={() => updateSlot(slot.id, { color: defaultEnvColor(index) })}
              onRawChange={(rawText) => updateSlot(slot.id, { rawText })}
              hideContents={hideEnvContents}
              onClear={() => updateSlot(slot.id, { rawText: '' })}
              onRemoveSlot={() => removeSlot(slot.id)}
              canRemove={slots.length > 1}
            />
          ))}
          </div>
        </section>

        {hasAnyContent ? (
          <>
            <section className="space-y-3">
              {legendCollapsed && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setLegendCollapsed(false)}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    Show legend
                  </button>
                </div>
              )}
              <div className={legendCollapsed ? '' : 'grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start'}>
              <ComparisonMatrix
                slots={parsedSlots}
                keys={keysForMatrix}
                alignKeys={alignKeys}
                rowMaskByKey={rowMaskByKey}
                hideContents={hideTableContents}
                onUpdateCellValue={updateCellValue}
                onRenameKey={renameKeyAcrossEnvs}
                onToast={showToast}
                keyColumnWidth={keyColumnWidth}
                valueColumnWidth={valueColumnWidth}
                onKeyColumnWidthChange={updateKeyColumnWidth}
                onValueColumnWidthChange={updateValueColumnWidth}
              />
                {!legendCollapsed && (
                  <div className="w-full lg:sticky lg:top-4 lg:w-fit lg:max-w-88 lg:self-start">
                    <Legend
                      collapsed={legendCollapsed}
                      onToggleCollapse={() => setLegendCollapsed((c) => !c)}
                      options={legendFilterOptions}
                      envColors={parsedSlots.map((slot) => slot.color)}
                      envLabels={parsedSlots.map((slot, index) => slot.displayName.trim() || `Env ${index + 1}`)}
                      selectedFilterIds={activeLegendFilterIds}
                      onSelectedFilterIdsChange={setLegendFilterIds}
                      totalKeyCount={keysInOrder.length}
                      filteredKeyCount={keysForMatrix.length}
                    />
                  </div>
                )}
              </div>
            </section>
            <HybridBuilder
              slots={parsedSlots}
              priorityOrder={hybridOrder}
              onReorder={setPriorityOrder}
              enabledSlotIds={activeHybridEnabledIds}
              onEnabledSlotIdsChange={setHybridEnabledIds}
              universe={hybridUniverse}
              onUniverseChange={setHybridUniverse}
              keysInOrder={keysInOrder}
            />
          </>
        ) : (
          <p className="rounded-xl border border-dashed border-zinc-300 bg-white/50 px-6 py-12 text-center text-sm text-zinc-500 dark:border-zinc-600 dark:bg-zinc-900/30 dark:text-zinc-400">
            Paste or drop .env content into at least one column to open the comparison matrix, row filters, and hybrid env
            merger.
          </p>
        )}
      </main>

      <footer className="border-t border-zinc-200 px-4 py-6 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
        <p>
          {persistenceActive
            ? 'Persistence saves encrypted state in localStorage. The encryption key exists only in this tab until you close it.'
            : 'Client-side only. Without persistence, close the tab to discard data.'}
        </p>
        <p className="mt-3">
          © {new Date().getFullYear()} {seo.authorName}.{' '}
          <a
            href={seo.authorUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-zinc-700 underline decoration-dotted underline-offset-4 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            More creations on eliott.cloud
          </a>
        </p>
      </footer>
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-100 rounded-lg bg-zinc-950 px-3 py-2 text-sm font-medium text-white shadow-lg dark:bg-zinc-100 dark:text-zinc-950">
          {toastMessage}
        </div>
      )}
    </div>
  )
}
