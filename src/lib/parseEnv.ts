/**
 * Dotenv-style parser preserving line structure for round-trip export.
 * Aligned with common dotenv rules: quotes, escapes, multiline double-quoted, comments.
 */

export type KVEntry = {
  type: 'kv'
  key: string
  value: string
  rawLine: string
  lineIndex: number
}

export type BlankEntry = { type: 'blank'; rawLine: string; lineIndex: number }
export type CommentEntry = { type: 'comment'; rawLine: string; lineIndex: number }

export type ParsedEntry = BlankEntry | CommentEntry | KVEntry

export type ParsedEnv = {
  entries: ParsedEntry[]
  /** Last occurrence wins per file (dotenv semantics) */
  keyToLastEntry: Map<string, KVEntry>
}

const KEY_NAME_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)$/

export function isValidEnvKeyName(key: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
}

function stripInlineCommentUnquoted(rest: string): string {
  let i = 0
  const s = rest.trimEnd()
  while (i < s.length) {
    const hash = s.indexOf('#', i)
    if (hash === -1) return s.trimEnd()
    if (hash === 0) return ''
    const before = s[hash - 1]!
    if (/\s/.test(before)) {
      return s.slice(0, hash).trimEnd()
    }
    i = hash + 1
  }
  return s
}

/** Scan double-quoted string starting at column `col` in `lines[lineIdx]` (first char after opening `"`). */
function scanDoubleQuoted(
  lines: string[],
  lineIdx: number,
  col: number
): { value: string; endLineIdx: number; endCol: number } {
  let value = ''
  let li = lineIdx
  let c = col

  outer: while (li < lines.length) {
    const line = lines[li]!
    while (c < line.length) {
      const ch = line[c]!
      if (ch === '\\') {
        if (c + 1 >= line.length) {
          value += '\n'
          li++
          c = 0
          continue outer
        }
        const esc = line[c + 1]!
        if (esc === 'n') {
          value += '\n'
          c += 2
          continue
        }
        if (esc === 'r') {
          value += '\r'
          c += 2
          continue
        }
        if (esc === 't') {
          value += '\t'
          c += 2
          continue
        }
        if (esc === '"' || esc === '\\' || esc === "'") {
          value += esc
          c += 2
          continue
        }
        value += esc
        c += 2
        continue
      }
      if (ch === '"') {
        return { value, endLineIdx: li, endCol: c + 1 }
      }
      value += ch
      c++
    }
    value += '\n'
    li++
    c = 0
  }

  const last = Math.max(0, lines.length - 1)
  return { value, endLineIdx: last, endCol: lines[last]?.length ?? 0 }
}

function parseSingleQuoted(line: string, start: number): { value: string; end: number } {
  let i = start
  let out = ''
  while (i < line.length) {
    const c = line[i]!
    if (c === '\\' && line[i + 1] === "'") {
      out += "'"
      i += 2
      continue
    }
    if (c === "'") {
      return { value: out, end: i + 1 }
    }
    out += c
    i++
  }
  return { value: out, end: line.length }
}

function parseUnquoted(rest: string): string {
  return stripInlineCommentUnquoted(rest)
}

export function parseEnv(content: string): ParsedEnv {
  const raw = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const lines = raw.length === 0 ? [] : raw.split('\n')
  const entries: ParsedEntry[] = []
  const keyToLastEntry = new Map<string, KVEntry>()

  let lineIdx = 0
  while (lineIdx < lines.length) {
    const line = lines[lineIdx]!
    const lineIndex = lineIdx

    if (/^\s*$/.test(line)) {
      entries.push({ type: 'blank', rawLine: line, lineIndex })
      lineIdx++
      continue
    }

    if (/^\s*#/.test(line)) {
      entries.push({ type: 'comment', rawLine: line, lineIndex })
      lineIdx++
      continue
    }

    const eq = line.indexOf('=')
    if (eq <= 0) {
      entries.push({ type: 'comment', rawLine: line, lineIndex })
      lineIdx++
      continue
    }

    const keyPart = line.slice(0, eq).trim()
    const keyMatch = keyPart.match(KEY_NAME_RE)
    if (!keyMatch) {
      entries.push({ type: 'comment', rawLine: line, lineIndex })
      lineIdx++
      continue
    }

    const key = keyMatch[1]!
    const rest = line.slice(eq + 1)
    let value: string
    const leadingWs = rest.match(/^\s*/)?.[0]?.length ?? 0
    const trimmedStart = rest.slice(leadingWs)
    const valueStartInLine = eq + 1 + leadingWs

    if (trimmedStart.startsWith('"')) {
      const col = valueStartInLine + 1
      const { value: v, endLineIdx, endCol } = scanDoubleQuoted(lines, lineIdx, col)
      value = v
      const rawParts = lines.slice(lineIdx, endLineIdx + 1)
      if (rawParts.length > 0) {
        rawParts[rawParts.length - 1] = lines[endLineIdx]!.slice(0, endCol)
      }
      const rawLine = rawParts.join('\n')
      const kv: KVEntry = { type: 'kv', key, value, rawLine, lineIndex }
      entries.push(kv)
      keyToLastEntry.set(key, kv)
      lineIdx = endLineIdx + 1
      continue
    }

    if (trimmedStart.startsWith("'")) {
      const i = valueStartInLine + 1
      const { value: v } = parseSingleQuoted(line, i)
      value = v
      const kv: KVEntry = { type: 'kv', key, value, rawLine: line, lineIndex }
      entries.push(kv)
      keyToLastEntry.set(key, kv)
      lineIdx++
      continue
    }

    value = parseUnquoted(rest)
    const kv: KVEntry = { type: 'kv', key, value, rawLine: line, lineIndex }
    entries.push(kv)
    keyToLastEntry.set(key, kv)
    lineIdx++
  }

  return { entries, keyToLastEntry }
}

/** Escape a value for dotenv export (double-quoted when needed). */
export function serializeValue(value: string): string {
  if (value === '') return ''
  if (/[\s#"'\n\r\t\\]/.test(value)) {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
    return `"${escaped}"`
  }
  if (/#/.test(value)) {
    const escaped = value
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t')
    return `"${escaped}"`
  }
  return value
}

/** Rebuild .env text from entries (KV lines re-serialized; blanks/comments preserved). */
export function serializeEnvEntries(entries: ParsedEntry[]): string {
  const lines: string[] = []
  for (const e of entries) {
    if (e.type === 'blank' || e.type === 'comment') {
      lines.push(e.rawLine)
    } else {
      lines.push(`${e.key}=${serializeValue(e.value)}`)
    }
  }
  return lines.join('\n')
}

/** Update the last occurrence of a key or append a new one while preserving comments/blanks. */
export function upsertEnvValue(content: string, key: string, value: string): string {
  const parsed = parseEnv(content)
  const nextEntries = [...parsed.entries]
  const lastEntry = parsed.keyToLastEntry.get(key)

  if (lastEntry) {
    return serializeEnvEntries(
      nextEntries.map((entry) =>
        entry.type === 'kv' && entry.key === key && entry.lineIndex === lastEntry.lineIndex
          ? { ...entry, value }
          : entry
      )
    )
  }

  const lastLineIndex = nextEntries[nextEntries.length - 1]?.lineIndex ?? -1
  if (nextEntries.length > 0 && nextEntries[nextEntries.length - 1]?.type !== 'blank') {
    nextEntries.push({ type: 'blank', rawLine: '', lineIndex: lastLineIndex + 1 })
  }
  nextEntries.push({ type: 'kv', key, value, rawLine: '', lineIndex: lastLineIndex + 2 })
  return serializeEnvEntries(nextEntries)
}

/** Rename every occurrence of a key while preserving values and file structure. */
export function renameEnvKey(content: string, fromKey: string, toKey: string): string {
  if (fromKey === toKey) return content
  const parsed = parseEnv(content)
  return serializeEnvEntries(
    parsed.entries.map((entry) =>
      entry.type === 'kv' && entry.key === fromKey ? { ...entry, key: toKey } : entry
    )
  )
}
