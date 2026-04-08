import { describe, expect, it } from 'vitest'
import {
  isValidEnvKeyName,
  parseEnv,
  removeKeyFromEnv,
  renameEnvKey,
  serializeEnvEntries,
  serializeValue,
  upsertEnvValue,
} from './parseEnv'

describe('parseEnv', () => {
  it('parses blank and comments', () => {
    const { entries, keyToLastEntry } = parseEnv('\n# hi\n\n')
    expect(entries.map((e) => e.type)).toEqual(['blank', 'comment', 'blank', 'blank'])
    expect(keyToLastEntry.size).toBe(0)
  })

  it('parses unquoted and strips inline comment after whitespace', () => {
    const { keyToLastEntry } = parseEnv('FOO=bar # not value\n')
    expect(keyToLastEntry.get('FOO')?.value).toBe('bar')
  })

  it('keeps # inside unquoted value when not preceded by whitespace before #', () => {
    const { keyToLastEntry } = parseEnv('FOO=bar#baz\n')
    expect(keyToLastEntry.get('FOO')?.value).toBe('bar#baz')
  })

  it('parses double-quoted with escapes', () => {
    const { keyToLastEntry } = parseEnv('X="a\\"b\\nc"\n')
    expect(keyToLastEntry.get('X')?.value).toBe('a"b\nc')
  })

  it('parses multiline double-quoted', () => {
    const src = 'PRIV="line1\nline2"\n'
    const { keyToLastEntry, entries } = parseEnv(src)
    expect(keyToLastEntry.get('PRIV')?.value).toBe('line1\nline2')
    const kv = entries.find((e) => e.type === 'kv')
    expect(kv?.type === 'kv' && kv.rawLine.includes('line1')).toBe(true)
  })

  it('parses single-quoted literally', () => {
    const { keyToLastEntry } = parseEnv("Y='a # b'\n")
    expect(keyToLastEntry.get('Y')?.value).toBe('a # b')
  })

  it('duplicate keys: last wins', () => {
    const { keyToLastEntry } = parseEnv('A=1\nA=2\n')
    expect(keyToLastEntry.get('A')?.value).toBe('2')
  })

  it('handles export prefix', () => {
    const { keyToLastEntry } = parseEnv('export BAZ=qux\n')
    expect(keyToLastEntry.get('BAZ')?.value).toBe('qux')
  })

  it('UTF-8 values', () => {
    const { keyToLastEntry } = parseEnv('U=你好\n')
    expect(keyToLastEntry.get('U')?.value).toBe('你好')
  })
})

describe('serialize', () => {
  it('serializeValue quotes when needed', () => {
    expect(serializeValue('hello')).toBe('hello')
    expect(serializeValue('a b')).toBe('"a b"')
    expect(serializeValue('x\ny')).toBe('"x\\ny"')
  })

  it('serializeEnvEntries round-trip structure', () => {
    const p = parseEnv('# c\nKEY=v\n\n')
    const out = serializeEnvEntries(p.entries)
    expect(out).toContain('# c')
    expect(out).toContain('KEY=v')
  })

  it('updates the last occurrence of an existing key', () => {
    const out = upsertEnvValue('# c\nKEY=old\nKEY=last\n', 'KEY', 'new value')
    expect(out).toBe('# c\nKEY=old\nKEY="new value"\n')
  })

  it('appends a missing key while preserving prior lines', () => {
    const out = upsertEnvValue('# c\nFOO=bar', 'KEY', 'new')
    expect(out).toBe('# c\nFOO=bar\n\nKEY=new')
  })

  it('renames every occurrence of a key while preserving values', () => {
    const out = renameEnvKey('# c\nKEY=old\nOTHER=x\nKEY=last\n', 'KEY', 'RENAMED_KEY')
    expect(out).toBe('# c\nRENAMED_KEY=old\nOTHER=x\nRENAMED_KEY=last\n')
  })

  it('removes every assignment for a key in one env', () => {
    const out = removeKeyFromEnv('# c\nA=1\nB=2\nA=3\n', 'A')
    expect(out).toBe('# c\nB=2\n')
  })

  it('validates env key names', () => {
    expect(isValidEnvKeyName('VALID_KEY_2')).toBe(true)
    expect(isValidEnvKeyName('2INVALID')).toBe(false)
    expect(isValidEnvKeyName('NOT-VALID')).toBe(false)
  })
})
