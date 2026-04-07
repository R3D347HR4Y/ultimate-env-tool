import type { ParsedEnv } from './lib/parseEnv'

export type HybridUniverse = 'union' | 'intersection'

export type EnvSlot = {
  id: string
  displayName: string
  rawText: string
  color: string
}

export type EnvSlotParsed = EnvSlot & {
  parsed: ParsedEnv
}

const DEFAULT_ENV_COLORS = [
  '#3b82f6',
  '#8b5cf6',
  '#22c55e',
  '#ef4444',
  '#f59e0b',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
]

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100
  const light = l / 100
  const c = (1 - Math.abs(2 * light - 1)) * sat
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = light - c / 2

  let r = 0
  let g = 0
  let b = 0

  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }

  const toHex = (value: number) =>
    Math.round((value + m) * 255)
      .toString(16)
      .padStart(2, '0')

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function defaultEnvColor(index: number): string {
  return DEFAULT_ENV_COLORS[index] ?? hslToHex((index * 137.508) % 360, 70, 52)
}

export function emptySlot(id: string, index: number): EnvSlot {
  return {
    id,
    displayName: `Env ${index + 1}`,
    rawText: '',
    color: defaultEnvColor(index),
  }
}

export function normalizeEnvSlot(slot: Partial<EnvSlot>, index: number): EnvSlot {
  return {
    id: slot.id ?? `slot-${index + 1}`,
    displayName: slot.displayName ?? `Env ${index + 1}`,
    rawText: slot.rawText ?? '',
    color: slot.color ?? defaultEnvColor(index),
  }
}

export const MAX_ENVS = 8
export const DEFAULT_SLOT_COUNT = 2
