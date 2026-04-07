import { describe, expect, it } from 'vitest'
import { cellStyleForValueMatch, summarizeValueRelations } from './presence'
import { parseEnv } from './parseEnv'
import type { EnvSlotParsed } from '../types'

function slotsFrom(raws: string[], colors = ['#3b82f6', '#8b5cf6', '#22c55e']): EnvSlotParsed[] {
  return raws.map((rawText, i) => ({
    id: `s${i}`,
    displayName: `E${i}`,
    rawText,
    color: colors[i] ?? '#94a3b8',
    parsed: parseEnv(rawText),
  }))
}

describe('cellStyleForValueMatch', () => {
  it('uses deep black when all envs define the same value', () => {
    const s = slotsFrom(['A=x', 'A=x', 'A=x'])
    const rowMask = 0b111
    for (let i = 0; i < 3; i++) {
      const st = cellStyleForValueMatch(s, 'A', i, ['A', 'B', 'C'], rowMask)
      expect(st.className).toContain('bg-zinc-950')
      expect(st.leftBarGradient).toBeUndefined()
    }
  })

  it('uses a blended tint plus a striped left border for a shared subset', () => {
    const s = slotsFrom(['A=x', 'A=x', 'A=y'])
    const rowMask = 0b111
    const a = cellStyleForValueMatch(s, 'A', 0, ['A', 'B', 'C'], rowMask)
    const b = cellStyleForValueMatch(s, 'A', 1, ['A', 'B', 'C'], rowMask)
    expect(a.style?.backgroundColor).toBe('rgba(99, 111, 246, 0.28)')
    expect(b.style?.backgroundColor).toBe('rgba(99, 111, 246, 0.28)')
    expect(a.leftBarGradient).toContain('#3b82f6')
    expect(a.leftBarGradient).toContain('#8b5cf6')
  })

  it('uses the env color tint for a unique conflicting value', () => {
    const s = slotsFrom(['A=x', 'A=x', 'A=y'])
    const rowMask = 0b111
    const c = cellStyleForValueMatch(s, 'A', 2, ['A', 'B', 'C'], rowMask)
    expect(c.style?.backgroundColor).toContain('rgba(34, 197, 94')
    expect(c.leftBarGradient).toContain('#22c55e')
  })

  it('uses gray when key is missing', () => {
    const s = slotsFrom(['A=x', '', 'A=x'])
    const rowMask = 0b101
    const missing = cellStyleForValueMatch(s, 'A', 1, ['A', 'B', 'C'], rowMask)
    expect(missing.className).toContain('zinc')
  })
})

describe('summarizeValueRelations', () => {
  it('marks allDifferent when every env defines a distinct value', () => {
    const s = slotsFrom(['A=x', 'A=y', 'A=z'])
    const summary = summarizeValueRelations(s, 'A')
    expect(summary.allDifferent).toBe(true)
    expect(summary.uniqueValueSlotIndices).toEqual([0, 1, 2])
  })

  it('tracks missing envs for no-value filters', () => {
    const s = slotsFrom(['A=x', '', 'A=y'])
    const summary = summarizeValueRelations(s, 'A')
    expect(summary.missingSlotIndices).toEqual([1])
    expect(summary.allDifferent).toBe(false)
  })

  it('marks hasEmptyValues when at least one env has an explicit empty value', () => {
    const s = slotsFrom(['A=', 'A=x', ''])
    const summary = summarizeValueRelations(s, 'A')
    expect(summary.hasEmptyValues).toBe(true)
    expect(summary.missingSlotIndices).toEqual([2])
  })

  it('does not mark hasEmptyValues when the key is only missing, not explicitly empty', () => {
    const s = slotsFrom(['A=x', '', 'A=y'])
    const summary = summarizeValueRelations(s, 'A')
    expect(summary.hasEmptyValues).toBe(false)
    expect(summary.missingSlotIndices).toEqual([1])
  })
})
