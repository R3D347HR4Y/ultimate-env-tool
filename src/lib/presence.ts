/** Bitmask of which env slots define a key (for N <= 32 slots). */
export type PresenceMask = number

export function maskFromIndices(indices: number[]): PresenceMask {
  let m = 0
  for (const i of indices) {
    if (i >= 0 && i < 32) m |= 1 << i
  }
  return m
}

export function indicesFromMask(mask: PresenceMask, slotCount: number): number[] {
  const out: number[] = []
  for (let i = 0; i < slotCount && i < 32; i++) {
    if (mask & (1 << i)) out.push(i)
  }
  return out
}

export function popcount(mask: PresenceMask): number {
  let n = 0
  let m = mask
  while (m) {
    n += m & 1
    m >>>= 1
  }
  return n
}

export type CellStyle = {
  className: string
  label: string
  style?: {
    backgroundColor?: string
  }
  leftBarGradient?: string
}

const MISSING_CELL = 'bg-zinc-100/80 dark:bg-zinc-800/50'
const ALL_MATCH_CELL = 'bg-zinc-950 dark:bg-black'

/** Red = unique to one file; blue = all files; other hues for intermediate subsets. */
const SUBSET_PALETTE = [
  'bg-amber-500/15 border-amber-500 dark:bg-amber-400/20 dark:border-amber-400',
  'bg-emerald-500/15 border-emerald-500 dark:bg-emerald-400/20 dark:border-emerald-400',
  'bg-violet-500/15 border-violet-500 dark:bg-violet-400/20 dark:border-violet-400',
  'bg-orange-500/15 border-orange-500 dark:bg-orange-400/20 dark:border-orange-400',
  'bg-cyan-500/15 border-cyan-500 dark:bg-cyan-400/20 dark:border-cyan-400',
  'bg-pink-500/15 border-pink-500 dark:bg-pink-400/20 dark:border-pink-400',
  'bg-lime-600/15 border-lime-600 dark:bg-lime-400/20 dark:border-lime-400',
  'bg-fuchsia-500/15 border-fuchsia-500 dark:bg-fuchsia-400/20 dark:border-fuchsia-400',
]

function paletteIndex(mask: PresenceMask, slotCount: number): number {
  let h = mask * 2654435761
  h ^= slotCount * 1597334677
  return Math.abs(h) % SUBSET_PALETTE.length
}

function clipVal(s: string, max = 80): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}...`
}

function hexToRgb(color: string): { r: number; g: number; b: number } | null {
  const hex = color.trim().replace('#', '')
  const normalized =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  }
}

function withAlpha(color: string, alpha: number): string {
  const rgb = hexToRgb(color)
  if (!rgb) return color
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

function averageColors(colors: string[]): string {
  const rgbs = colors.map(hexToRgb).filter((rgb): rgb is { r: number; g: number; b: number } => rgb !== null)
  if (rgbs.length === 0) return '#94a3b8'

  const totals = rgbs.reduce(
    (acc, rgb) => ({
      r: acc.r + rgb.r,
      g: acc.g + rgb.g,
      b: acc.b + rgb.b,
    }),
    { r: 0, g: 0, b: 0 }
  )

  const toHex = (value: number) => Math.round(value).toString(16).padStart(2, '0')
  const r = totals.r / rgbs.length
  const g = totals.g / rgbs.length
  const b = totals.b / rgbs.length
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function gradientForColors(colors: string[]): string | undefined {
  if (colors.length === 0) return undefined
  if (colors.length === 1) return `linear-gradient(${colors[0]}, ${colors[0]})`

  const stops: string[] = []
  colors.forEach((color, index) => {
    const start = (index / colors.length) * 100
    const end = ((index + 1) / colors.length) * 100
    stops.push(`${color} ${start}%`, `${color} ${end}%`)
  })
  return `linear-gradient(to bottom, ${stops.join(', ')})`
}

export function describePresenceMask(
  rowMask: PresenceMask,
  slotCount: number,
  names: string[]
): string {
  const k = popcount(rowMask)
  if (k === 0) return 'Key not defined in any env'
  if (k === 1) {
    const i = indicesFromMask(rowMask, slotCount)[0] ?? 0
    return `Key only in ${names[i] ?? `Env ${i + 1}`}`
  }
  if (k === slotCount && slotCount > 0) return 'Key present in all envs'
  const idxList = indicesFromMask(rowMask, slotCount)
  return `Key in: ${idxList.map((i) => names[i] ?? `Env ${i + 1}`).join(', ')}`
}

export type EnvSlotParsedLite = {
  color: string
  parsed: { keyToLastEntry: Map<string, { value: string }> }
}

export type ValueRelationSummary = {
  allMatch: boolean
  allDifferent: boolean
  sharedValueMasks: number[]
  uniqueValueSlotIndices: number[]
  missingSlotIndices: number[]
  hasEmptyValues: boolean
}

/**
 * Requested visual rules:
 * - Missing key => gray.
 * - One shared value across every env => deep black.
 * - Shared value across a strict subset (size >= 2) => averaged member color with left border striped by member env colors.
 * - Unique value group (size = 1) => background tinted with that env's chosen color.
 */
export function cellStyleForValueMatch(
  slots: EnvSlotParsedLite[],
  key: string,
  slotIndex: number,
  names: string[],
  rowMask: PresenceMask
): CellStyle {
  const bit = 1 << slotIndex
  const inRow = (rowMask & bit) !== 0
  if (!inRow) {
    return {
      className: MISSING_CELL,
      label: 'Key not set in this env',
      leftBarGradient: gradientForColors(['#71717a']),
    }
  }

  const slotCount = slots.length
  const value = slots[slotIndex]?.parsed.keyToLastEntry.get(key)?.value ?? ''

  const groups = new Map<string, number[]>()
  slots.forEach((slot, index) => {
    const entry = slot.parsed.keyToLastEntry.get(key)
    if (!entry) return
    const arr = groups.get(entry.value) ?? []
    arr.push(index)
    groups.set(entry.value, arr)
  })

  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const minA = Math.min(...a[1])
    const minB = Math.min(...b[1])
    return minA - minB
  })

  const currentGroup = sortedGroups.find(([, members]) => members.includes(slotIndex))
  const members = currentGroup?.[1] ?? [slotIndex]
  const presence = describePresenceMask(rowMask, slotCount, names)
  const memberNames = members.map((i) => names[i] ?? `Env ${i + 1}`).join(', ')
  const memberColors = members.map((i) => slots[i]?.color ?? '#94a3b8')

  if (sortedGroups.length === 1 && members.length === slotCount) {
    return {
      className: ALL_MATCH_CELL,
      label: `Value: "${clipVal(value)}". All envs share this key and this value. ${presence}.`,
    }
  }

  if (members.length >= 2) {
    const sharedColor = averageColors(memberColors)
    return {
      className: '',
      style: {
        backgroundColor: withAlpha(sharedColor, 0.28),
      },
      label: `Value: "${clipVal(value)}". Shared by ${memberNames}. Other envs either differ or omit the key. ${presence}.`,
      leftBarGradient: gradientForColors(memberColors),
    }
  }

  const envColor = slots[slotIndex]?.color ?? '#3b82f6'
  return {
    className: '',
    style: {
      backgroundColor: withAlpha(envColor, 0.22),
    },
    leftBarGradient: gradientForColors([envColor]),
    label: `Value: "${clipVal(value)}". Only ${names[slotIndex] ?? `Env ${slotIndex + 1}`} has this value for the key. ${presence}.`,
  }
}

export function summarizeValueRelations(
  slots: EnvSlotParsedLite[],
  key: string
): ValueRelationSummary {
  const groups = new Map<string, number[]>()
  let hasEmptyValues = false
  const presentSlotIndices: number[] = []

  slots.forEach((slot, index) => {
    const entry = slot.parsed.keyToLastEntry.get(key)
    if (!entry) return
    presentSlotIndices.push(index)
    if (entry.value === '') hasEmptyValues = true
    const arr = groups.get(entry.value) ?? []
    arr.push(index)
    groups.set(entry.value, arr)
  })

  const masks = [...groups.values()].map((indices) => maskFromIndices(indices))
  const sharedValueMasks = masks.filter((mask) => popcount(mask) >= 2)
  const uniqueValueSlotIndices = masks
    .filter((mask) => popcount(mask) === 1)
    .map((mask) => indicesFromMask(mask, slots.length)[0]!)

  const missingSlotIndices: number[] = []
  for (let i = 0; i < slots.length; i++) {
    if (!presentSlotIndices.includes(i)) missingSlotIndices.push(i)
  }

  const allMatch =
    groups.size === 1 &&
    slots.length > 0 &&
    [...groups.values()][0]?.length === slots.length

  const allDifferent =
    slots.length > 0 &&
    presentSlotIndices.length === slots.length &&
    groups.size === slots.length &&
    uniqueValueSlotIndices.length === slots.length

  return {
    allMatch,
    allDifferent,
    sharedValueMasks,
    uniqueValueSlotIndices,
    missingSlotIndices,
    hasEmptyValues,
  }
}

export function legendEntries(
  masks: Set<PresenceMask>,
  slotCount: number,
  names: string[]
): { mask: PresenceMask; label: string; className: string }[] {
  const sorted = [...masks].filter((m) => m !== 0).sort((a, b) => {
    const pa = popcount(a)
    const pb = popcount(b)
    if (pa !== pb) return pa - pb
    return a - b
  })

  return sorted.map((mask) => {
    const k = popcount(mask)
    let label: string
    let className: string
    if (k === 1) {
      const i = indicesFromMask(mask, slotCount)[0] ?? 0
      label = `Unique to ${names[i] ?? `Env ${i + 1}`}`
      className = 'bg-rose-500/15 border-rose-600 dark:bg-rose-400/20 dark:border-rose-400'
    } else if (k === slotCount && slotCount > 0) {
      label = 'Common to all envs'
      className = 'bg-sky-500/15 border-sky-600 dark:bg-sky-400/20 dark:border-sky-400'
    } else {
      const idxList = indicesFromMask(mask, slotCount)
      label = idxList.map((i) => names[i] ?? `Env ${i + 1}`).join(' · ')
      className = SUBSET_PALETTE[paletteIndex(mask, slotCount)] ?? SUBSET_PALETTE[0]!
    }
    return { mask, label, className }
  })
}
