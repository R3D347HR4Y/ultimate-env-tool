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
import { heroDetail, heroTagline, seo } from './seo'

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

      <header className="overflow-x-clip border-b border-zinc-200/90 bg-gradient-to-b from-white to-zinc-50/90 px-4 py-4 backdrop-blur-md dark:border-zinc-800 dark:from-zinc-950 dark:to-zinc-950/92">
        <div className={`mx-auto ${layoutWidthClass} space-y-3`}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
            <div className="min-w-0 flex-1 text-left">
              <h1
                id="site-title"
                className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
              >
                {seo.siteName}
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm font-medium leading-snug text-zinc-800 dark:text-zinc-200">
                {heroTagline}
              </p>
              <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                {heroDetail}
              </p>
            </div>
            <aside className="w-full shrink-0 sm:w-auto sm:max-w-md">
              <div className="rounded-2xl border border-zinc-200/90 bg-white/80 p-3 shadow-sm ring-1 ring-black/[0.04] dark:border-zinc-700/90 dark:bg-zinc-900/70 dark:ring-white/[0.06]">
                <p
                  className={`mb-2 text-sm font-semibold tracking-tight ${
                    persistenceActive
                      ? 'text-emerald-700 dark:text-emerald-400'
                      : 'text-zinc-500 dark:text-zinc-400'
                  }`}
                >
                  {persistenceActive ? 'Persistence on' : 'Persistence off'}
                </p>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {bootstrapped && !persistenceActive && !showUnlock && (
                    <button
                      type="button"
                      onClick={() => setUnlockDialogOpen(true)}
                      className="inline-flex max-w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-800 sm:text-sm"
                    >
                      Import archive
                    </button>
                  )}
                  {bootstrapped && !persistenceActive && !showUnlock && (
                    <button
                      type="button"
                      onClick={() => setEnableDialogOpen(true)}
                      className="inline-flex max-w-full items-center justify-center rounded-xl bg-violet-600 px-3 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-violet-500 active:scale-[0.98] dark:bg-violet-600 dark:hover:bg-violet-500 sm:text-sm"
                    >
                      Enable persistence
                    </button>
                  )}
                  {bootstrapped && persistenceActive && (
                    <button
                      type="button"
                      onClick={() => void exportEncryptedArchive()}
                      className="inline-flex max-w-full items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-800 sm:text-sm"
                    >
                      Export archive
                    </button>
                  )}
                  {bootstrapped && persistenceActive && (
                    <button
                      type="button"
                      onClick={purgeEncryptedStorage}
                      className="inline-flex max-w-full items-center justify-center rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-medium text-rose-800 transition hover:bg-rose-100 active:scale-[0.98] dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200 dark:hover:bg-rose-950/60 sm:text-sm"
                    >
                      Purge storage
                    </button>
                  )}
                </div>
              </div>
            </aside>
          </div>

          <nav
            aria-label="Jump to section"
            className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-3 sm:gap-y-1.5"
          >
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500 dark:text-zinc-400">
              Jump to
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <a
                href="#environment-columns"
                className="rounded-md border border-zinc-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
              >
                Env columns
              </a>
              <a
                href="#compare-area"
                className="rounded-md border border-zinc-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
              >
                Matrix & merge
              </a>
              <a
                href="#how-it-works"
                className="rounded-md border border-zinc-200/90 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:border-zinc-500 dark:hover:bg-zinc-800"
              >
                Privacy & source
              </a>
            </div>
          </nav>
        </div>
      </header>

      <main
        className={`mx-auto ${layoutWidthClass} space-y-5 px-4 py-5 ${showUnlock ? 'pointer-events-none opacity-40' : ''}`}
        aria-labelledby="site-title"
        aria-hidden={showUnlock}
      >
        <section
          id="workspace-options"
          aria-label="Workspace options"
          className="scroll-mt-32 rounded-xl border border-zinc-200/90 bg-white/90 p-2.5 shadow-sm ring-1 ring-black/[0.04] dark:border-zinc-700/90 dark:bg-zinc-900/55 dark:ring-white/[0.06]"
        >
          <div className="space-y-2">
            <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
              Display & privacy
            </p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200/80 bg-zinc-50/70 px-2 py-1.5 transition hover:border-zinc-300 hover:bg-zinc-50 sm:col-span-3 lg:col-span-4 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 dark:border-zinc-700/80 dark:bg-zinc-800/40 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/70">
                <input
                  type="checkbox"
                  checked={alignKeys}
                  onChange={(e) => setAlignKeys(e.target.checked)}
                  disabled={showUnlock}
                  className="mt-px h-3.5 w-3.5 shrink-0 rounded border-zinc-300 text-violet-600 focus:ring-1 focus:ring-violet-500/30 dark:border-zinc-600 dark:bg-zinc-900"
                />
                <span className="min-w-0 text-[11px] leading-snug text-zinc-800 dark:text-zinc-200">
                  Align key sets <span className="text-zinc-500 dark:text-zinc-400">(empty cells)</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200/80 bg-zinc-50/70 px-2 py-1.5 transition hover:border-zinc-300 hover:bg-zinc-50 sm:col-span-3 lg:col-span-4 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 dark:border-zinc-700/80 dark:bg-zinc-800/40 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/70">
                <input
                  type="checkbox"
                  checked={sortAsc}
                  onChange={(e) => setSortAsc(e.target.checked)}
                  disabled={showUnlock}
                  className="mt-px h-3.5 w-3.5 shrink-0 rounded border-zinc-300 text-violet-600 focus:ring-1 focus:ring-violet-500/30 dark:border-zinc-600 dark:bg-zinc-900"
                />
                <span className="min-w-0 text-[11px] leading-snug text-zinc-800 dark:text-zinc-200">Sort keys A–Z</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200/80 bg-zinc-50/70 px-2 py-1.5 transition hover:border-zinc-300 hover:bg-zinc-50 sm:col-span-3 lg:col-span-4 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 dark:border-zinc-700/80 dark:bg-zinc-800/40 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/70">
                <input
                  type="checkbox"
                  checked={useFullWidth}
                  onChange={(e) => setUseFullWidth(e.target.checked)}
                  disabled={showUnlock}
                  className="mt-px h-3.5 w-3.5 shrink-0 rounded border-zinc-300 text-violet-600 focus:ring-1 focus:ring-violet-500/30 dark:border-zinc-600 dark:bg-zinc-900"
                />
                <span className="min-w-0 text-[11px] leading-snug text-zinc-800 dark:text-zinc-200">Use full width</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200/80 bg-zinc-50/70 px-2 py-1.5 transition hover:border-zinc-300 hover:bg-zinc-50 sm:col-span-3 lg:col-span-6 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 dark:border-zinc-700/80 dark:bg-zinc-800/40 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/70">
                <input
                  type="checkbox"
                  checked={hideEnvContents}
                  onChange={(e) => setHideEnvContents(e.target.checked)}
                  disabled={showUnlock}
                  className="mt-px h-3.5 w-3.5 shrink-0 rounded border-zinc-300 text-violet-600 focus:ring-1 focus:ring-violet-500/30 dark:border-zinc-600 dark:bg-zinc-900"
                />
                <span className="min-w-0 text-[11px] leading-snug text-zinc-800 dark:text-zinc-200">
                  Hide env column text
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200/80 bg-zinc-50/70 px-2 py-1.5 transition hover:border-zinc-300 hover:bg-zinc-50 sm:col-span-3 lg:col-span-6 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50 dark:border-zinc-700/80 dark:bg-zinc-800/40 dark:hover:border-zinc-600 dark:hover:bg-zinc-800/70">
                <input
                  type="checkbox"
                  checked={hideTableContents}
                  onChange={(e) => setHideTableContents(e.target.checked)}
                  disabled={showUnlock}
                  className="mt-px h-3.5 w-3.5 shrink-0 rounded border-zinc-300 text-violet-600 focus:ring-1 focus:ring-violet-500/30 dark:border-zinc-600 dark:bg-zinc-900"
                />
                <span className="min-w-0 text-[11px] leading-snug text-zinc-800 dark:text-zinc-200">
                  Hide table values <span className="text-zinc-500 dark:text-zinc-400">(per row)</span>
                </span>
              </label>
            </div>
          </div>
        </section>

        <section
          id="environment-columns"
          className="scroll-mt-32 space-y-2.5"
          aria-label="Environment file columns"
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Environment columns</h2>
              <p className="mt-1 max-w-3xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                Paste, type, or drop each dotenv file into its own column. Name and color slots to tell local, staging, and
                production configs apart while you work with sensitive values privately on your machine.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:pt-0.5">
              <button
                type="button"
                onClick={addSlot}
                disabled={slots.length >= MAX_ENVS || showUnlock}
                className="inline-flex items-center justify-center rounded-xl bg-zinc-900 px-3 py-2 text-xs font-medium text-white shadow-sm transition hover:bg-zinc-800 active:scale-[0.98] disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white sm:text-sm"
              >
                Add env ({slots.length}/{MAX_ENVS})
              </button>
              <button
                type="button"
                onClick={clearAll}
                disabled={showUnlock}
                className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-50 active:scale-[0.98] dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800 sm:text-sm"
              >
                Clear all slots
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
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

        <section
          id="compare-area"
          className="scroll-mt-32 space-y-5"
          aria-label="Compare, filter, and merge"
        >
          {hasAnyContent ? (
            <>
              <section className="space-y-2.5">
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
                <div className={legendCollapsed ? 'min-w-0' : 'grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start'}>
                  <div className="min-w-0 max-w-full">
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
                  </div>
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
              <div id="hybrid-merge" className="scroll-mt-32">
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
              </div>
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-zinc-300 bg-white/50 px-5 py-8 text-center text-sm text-zinc-500 dark:border-zinc-600 dark:bg-zinc-900/30 dark:text-zinc-400">
              Paste or drop .env content into at least one column to open the comparison matrix, row filters, and hybrid env
              merger.
            </p>
          )}
        </section>

        <section
          id="how-it-works"
          className="scroll-mt-32 rounded-2xl border border-zinc-200/90 bg-white/90 p-4 shadow-sm ring-1 ring-black/[0.04] dark:border-zinc-700/90 dark:bg-zinc-900/55 dark:ring-white/[0.06]"
          aria-labelledby="how-it-works-heading"
        >
          <h2 id="how-it-works-heading" className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
            How it works, privacy, and hosting
          </h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Workflow</h3>
              <p className="mt-1">
                Paste or drop each dotenv file into a column, use the matrix to compare values and edit cells, filter rows from
                the legend, then optionally build a hybrid file from your chosen envs and priority order—all in this page.
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Data stays yours</h3>
              <p className="mt-1">
                Normal use keeps parsed text only in your browser tab memory. Optional persistence stores an{' '}
                <strong className="font-medium text-zinc-900 dark:text-zinc-100">encrypted</strong> snapshot in{' '}
                <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-800">localStorage</code> with{' '}
                <strong className="font-medium text-zinc-900 dark:text-zinc-100">AES-256-GCM</strong>; the key stays in JS memory
                until you close the tab. There is <strong className="font-medium text-zinc-900 dark:text-zinc-100">no account</strong>,{' '}
                <strong className="font-medium text-zinc-900 dark:text-zinc-100">no API</strong>, and{' '}
                <strong className="font-medium text-zinc-900 dark:text-zinc-100">no telemetry</strong> in this app: your secrets are not
                sent to a server for processing.
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Static hosting &amp; operator access
              </h3>
              <p className="mt-1">
                The deployed build is <strong className="font-medium text-zinc-900 dark:text-zinc-100">static files</strong> served
                by <strong className="font-medium text-zinc-900 dark:text-zinc-100">nginx</strong> (or any static host). We do not run an
                application server or database for your session. That means the <strong className="font-medium text-zinc-900 dark:text-zinc-100">host cannot read</strong> what you type in the fields—it only serves the same HTML, JS, and CSS bundle to everyone. Your
                inputs exist only in the browser unless you explicitly enable encrypted local backup or export an archive.
              </p>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Stack &amp; dependencies
              </h3>
              <p className="mt-1">
                Built with <strong className="font-medium text-zinc-900 dark:text-zinc-100">React 19</strong>,{' '}
                <strong className="font-medium text-zinc-900 dark:text-zinc-100">TypeScript</strong>,{' '}
                <strong className="font-medium text-zinc-900 dark:text-zinc-100">Vite 8</strong>,{' '}
                <strong className="font-medium text-zinc-900 dark:text-zinc-100">Tailwind CSS v4</strong>, and{' '}
                <strong className="font-medium text-zinc-900 dark:text-zinc-100">Vitest</strong> for tests. Production dependencies are
                intentionally minimal: <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-800">react</code> and{' '}
                <code className="rounded bg-zinc-200 px-1 py-0.5 text-xs dark:bg-zinc-800">react-dom</code> only.
              </p>
            </div>
            <div className="rounded-xl border border-amber-200/90 bg-amber-50/80 p-3.5 dark:border-amber-900/50 dark:bg-amber-950/30">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-900 dark:text-amber-200">
                Audit the code &amp; other tools
              </h3>
              <p className="mt-2 text-sm text-amber-950 dark:text-amber-100/90">
                This project is <strong className="font-medium">open source</strong> (
                <a
                  href={seo.sourceRepoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-amber-900 underline decoration-dotted underline-offset-2 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-50"
                >
                  browse or clone on GitHub
                </a>
                ). You can review every line and run it locally or self-host so behavior matches what you expect. Many other
                “.env compare” or “env merger” sites online are <strong className="font-medium">not meaningfully auditable</strong>: you
                cannot verify where your secrets go. Treat unaudited third-party paste tools as high risk for credentials.
              </p>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-200 px-4 py-4 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-500">
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
          {' · '}
          <a
            href={seo.sourceRepoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-zinc-700 underline decoration-dotted underline-offset-4 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
          >
            Source on GitHub
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
