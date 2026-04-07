import { useEffect, useState } from 'react'
import { copyToClipboard } from '../lib/download'
import { cellStyleForValueMatch } from '../lib/presence'
import type { PresenceMask } from '../lib/presence'
import type { EnvSlotParsed } from '../types'

type Props = {
  slots: EnvSlotParsed[]
  keys: string[]
  alignKeys: boolean
  rowMaskByKey: Map<string, PresenceMask>
  hideContents: boolean
  onUpdateCellValue: (slotId: string, key: string, value: string) => void
  onRenameKey: (fromKey: string, toKey: string) => boolean
  onToast: (message: string) => void
  keyColumnWidth: number
  valueColumnWidth: number
  onKeyColumnWidthChange: (width: number) => void
  onValueColumnWidthChange: (width: number) => void
}

type EditingCell = {
  slotId: string
  key: string
  value: string
}

type EditingKeyRow = {
  key: string
  value: string
}

const MIN_COLUMN_WIDTH = 180
const MIN_KEY_COLUMN_WIDTH = 50

export function ComparisonMatrix({
  slots,
  keys,
  alignKeys,
  rowMaskByKey,
  hideContents,
  onUpdateCellValue,
  onRenameKey,
  onToast,
  keyColumnWidth,
  valueColumnWidth,
  onKeyColumnWidthChange,
  onValueColumnWidthChange,
}: Props) {
  const names = slots.map((s) => s.displayName.trim() || 'Untitled')
  const totalTableWidth = keyColumnWidth + slots.length * valueColumnWidth
  const valuesWidth = slots.length * valueColumnWidth
  const [scrollLeft, setScrollLeft] = useState(0)
  const [revealedRows, setRevealedRows] = useState<Set<string>>(() => new Set())
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null)
  const [editingKeyRow, setEditingKeyRow] = useState<EditingKeyRow | null>(null)
  const keyColStyle = {
    width: `${keyColumnWidth}px`,
    minWidth: `${MIN_KEY_COLUMN_WIDTH}px`,
    maxWidth: `${keyColumnWidth}px`,
  }
  const valueColStyle = {
    width: `${valueColumnWidth}px`,
    minWidth: `${MIN_COLUMN_WIDTH}px`,
    maxWidth: `${valueColumnWidth}px`,
  }

  useEffect(() => {
    const validKeys = new Set(keys)
    setRevealedRows((prev) => {
      if (!hideContents) return new Set()
      const next = new Set([...prev].filter((key) => validKeys.has(key)))
      return next.size === prev.size ? prev : next
    })
  }, [hideContents, keys])

  useEffect(() => {
    if (!editingCell) return
    const slotExists = slots.some((slot) => slot.id === editingCell.slotId)
    const keyExists = keys.includes(editingCell.key)
    if (!slotExists || !keyExists) setEditingCell(null)
  }, [editingCell, keys, slots])

  useEffect(() => {
    if (!editingKeyRow) return
    if (!keys.includes(editingKeyRow.key)) setEditingKeyRow(null)
  }, [editingKeyRow, keys])

  if (keys.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 bg-white px-6 py-10 text-center text-sm text-zinc-500 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
        No keys match the current row filters. Clear filters in the legend to see all keys.
      </div>
    )
  }

  return (
    <div className="min-w-0 max-w-full rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-700 dark:bg-zinc-950">
      <div className="rounded-t-xl border-b border-zinc-200 px-4 py-3 dark:border-zinc-700">
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">Comparison matrix</h2>
        <p className="mt-1 max-w-3xl text-xs text-zinc-600 dark:text-zinc-400">
          Scan a side-by-side diff of every key across your dotenv columns: spot mismatches, rename a key in all envs at
          once, copy values, and edit cells in place. Use hide or row-mask controls when sharing your screen.
        </p>
      </div>
      <div className="sticky top-0 z-40 overflow-hidden border-b border-zinc-200 bg-zinc-50/95 backdrop-blur dark:border-zinc-700 dark:bg-zinc-900/95">
        <div className="flex min-w-0">
          <div
            className="relative shrink-0 border-r border-zinc-200 bg-zinc-50 px-3 py-2 font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            style={keyColStyle}
          >
            Key
            <span
              className="absolute inset-y-0 -right-1 z-20 w-3 cursor-col-resize select-none"
              onMouseDown={(event) => {
                event.preventDefault()
                const startX = event.clientX
                const startWidth = keyColumnWidth
                const prevCursor = document.body.style.cursor
                const prevSelect = document.body.style.userSelect
                document.body.style.cursor = 'col-resize'
                document.body.style.userSelect = 'none'

                const onMove = (moveEvent: MouseEvent) => {
                  const nextWidth = Math.max(MIN_KEY_COLUMN_WIDTH, startWidth + (moveEvent.clientX - startX))
                  onKeyColumnWidthChange(nextWidth)
                }

                const onUp = () => {
                  document.body.style.cursor = prevCursor
                  document.body.style.userSelect = prevSelect
                  window.removeEventListener('mousemove', onMove)
                  window.removeEventListener('mouseup', onUp)
                }

                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
              title="Drag to resize key column"
              aria-hidden
            />
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div
              className="flex"
              style={{
                width: `${valuesWidth}px`,
                transform: `translateX(-${scrollLeft}px)`,
              }}
            >
              {slots.map((s, i) => (
                <div
                  key={s.id}
                  className="relative shrink-0 border-l border-zinc-200 bg-zinc-50 px-3 py-2 font-semibold text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900/95 dark:text-zinc-100"
                  style={valueColStyle}
                >
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-full ring-1 ring-black/10 dark:ring-white/10"
                      style={{ backgroundColor: s.color }}
                      aria-hidden
                    />
                    {names[i]}
                  </span>
                  <span
                    className="absolute inset-y-0 -right-1 z-20 w-3 cursor-col-resize select-none"
                    onMouseDown={(event) => {
                      event.preventDefault()
                      const startX = event.clientX
                      const startWidth = valueColumnWidth
                      const prevCursor = document.body.style.cursor
                      const prevSelect = document.body.style.userSelect
                      document.body.style.cursor = 'col-resize'
                      document.body.style.userSelect = 'none'

                      const onMove = (moveEvent: MouseEvent) => {
                        const nextWidth = Math.max(MIN_COLUMN_WIDTH, startWidth + (moveEvent.clientX - startX))
                        onValueColumnWidthChange(nextWidth)
                      }

                      const onUp = () => {
                        document.body.style.cursor = prevCursor
                        document.body.style.userSelect = prevSelect
                        window.removeEventListener('mousemove', onMove)
                        window.removeEventListener('mouseup', onUp)
                      }

                      window.addEventListener('mousemove', onMove)
                      window.addEventListener('mouseup', onUp)
                    }}
                    title="Drag to resize column"
                    aria-hidden
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div
        className="max-w-full overflow-x-auto rounded-b-xl"
        onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}
      >
        <table
          className="table-fixed border-collapse text-left text-sm"
          style={{ width: `${totalTableWidth}px`, minWidth: `${totalTableWidth}px` }}
        >
          <colgroup>
            <col style={keyColStyle} />
            {slots.map((slot) => (
              <col
                key={`col-${slot.id}`}
                style={valueColStyle}
              />
            ))}
          </colgroup>
          <tbody>
          {keys.map((key) => {
            const rowMask = rowMaskByKey.get(key) ?? 0
            const rowMasked = hideContents && rowMask !== 0 && !revealedRows.has(key)
            const isEditingKeyRow = editingKeyRow?.key === key
            return (
              <tr
                key={key}
                className={`border-b border-zinc-200 dark:border-zinc-700 ${rowMasked ? 'cursor-pointer' : ''}`}
                onClick={
                  rowMasked
                    ? () => setRevealedRows((prev) => new Set(prev).add(key))
                    : undefined
                }
                title={rowMasked ? 'Click to reveal this row' : undefined}
              >
                <th
                  scope="row"
                  className="group sticky left-0 z-10 overflow-hidden border-r border-zinc-100 bg-zinc-50/95 px-3 py-2 font-mono text-xs font-medium text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900/95 dark:text-zinc-200"
                  style={keyColStyle}
                >
                  {isEditingKeyRow ? (
                    <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
                      <input
                        autoFocus
                        className="w-full rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs text-zinc-900 shadow-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                        value={editingKeyRow.value}
                        onChange={(event) =>
                          setEditingKeyRow((current) =>
                            current && current.key === key ? { ...current, value: event.target.value } : current
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            if (onRenameKey(key, editingKeyRow.value)) {
                              setEditingKeyRow(null)
                            }
                          }
                        }}
                        spellCheck={false}
                      />
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          className="rounded bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                          onClick={(event) => {
                            event.stopPropagation()
                            if (onRenameKey(key, editingKeyRow.value)) {
                              setEditingKeyRow(null)
                            }
                          }}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                          onClick={(event) => {
                            event.stopPropagation()
                            setEditingKeyRow(null)
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="block whitespace-normal wrap-anywhere">
                        {key}
                      </span>
                      <span
                        className="absolute top-0.5 right-1 z-10 flex items-center gap-1 rounded-md bg-white/70 p-0.5 opacity-20 transition-opacity group-hover:opacity-100 focus-within:opacity-100 dark:bg-zinc-950/70"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="rounded border border-zinc-300 bg-white/90 p-1 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950/80 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                          title={`Copy key ${key}`}
                          onClick={() => {
                            void copyToClipboard(key).then(() => {
                              onToast(`${key} copied to clipboard`)
                            })
                          }}
                        >
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current" aria-hidden>
                            <rect x="5" y="3" width="8" height="10" rx="1.5" strokeWidth="1.4" />
                            <path d="M3.5 10.5H3A1.5 1.5 0 0 1 1.5 9V3A1.5 1.5 0 0 1 3 1.5h5A1.5 1.5 0 0 1 9.5 3v.5" strokeWidth="1.4" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="rounded border border-zinc-300 bg-white/90 p-1 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950/80 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                          title={`Rename ${key} in all envs`}
                          onClick={() => setEditingKeyRow({ key, value: key })}
                        >
                          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current" aria-hidden>
                            <path d="M2 11.75V14h2.25L12.6 5.65 10.35 3.4 2 11.75Z" strokeWidth="1.3" />
                            <path d="m9.85 3.9 2.25 2.25 1.1-1.1a1.6 1.6 0 0 0 0-2.25l-.2-.2a1.6 1.6 0 0 0-2.25 0l-.9.9Z" strokeWidth="1.3" />
                          </svg>
                        </button>
                      </span>
                    </>
                  )}
                </th>
                {slots.map((slot, slotIdx) => {
                  const has = slot.parsed.keyToLastEntry.has(key)
                  const val = has ? slot.parsed.keyToLastEntry.get(key)!.value : ''
                  const display = rowMasked && has ? '(hidden)' : !has ? '(not set)' : val
                  const style = cellStyleForValueMatch(slots, key, slotIdx, names, rowMask)
                  const isEditing =
                    editingCell?.slotId === slot.id && editingCell?.key === key
                  const envName = names[slotIdx] ?? `Env ${slotIdx + 1}`

                  return (
                    <td
                      key={slot.id}
                      title={style.label}
                      className={`group relative overflow-visible px-2 py-1.5 pl-4 font-mono text-xs ${style.className} ${
                        !has && !alignKeys ? 'text-zinc-400 dark:text-zinc-500' : 'text-zinc-900 dark:text-zinc-100'
                      }`}
                      style={{
                        ...style.style,
                        ...valueColStyle,
                      }}
                    >
                      {isEditing ? (
                        <div className="space-y-2" onClick={(event) => event.stopPropagation()}>
                          <textarea
                            autoFocus
                            rows={Math.max(2, Math.min(4, editingCell.value.split('\n').length || 2))}
                            className="w-full resize-y rounded border border-zinc-300 bg-white px-2 py-1 font-mono text-xs leading-relaxed text-zinc-900 shadow-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                            value={editingCell.value}
                            onChange={(event) =>
                              setEditingCell((current) =>
                                current && current.slotId === slot.id && current.key === key
                                  ? { ...current, value: event.target.value }
                                  : current
                              )
                            }
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault()
                                onUpdateCellValue(slot.id, key, editingCell.value)
                                setEditingCell(null)
                              }
                            }}
                            spellCheck={false}
                          />
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="rounded bg-zinc-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
                              onClick={(event) => {
                                event.stopPropagation()
                                onUpdateCellValue(slot.id, key, editingCell.value)
                                setEditingCell(null)
                              }}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="rounded border border-zinc-300 px-2 py-1 text-[11px] text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                              onClick={(event) => {
                                event.stopPropagation()
                                setEditingCell(null)
                              }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <span
                            className={`block break-all ${
                              rowMasked
                                ? 'text-zinc-500/65 dark:text-zinc-400/60'
                                : !has
                                  ? 'text-zinc-500/55 dark:text-zinc-400/50'
                                  : ''
                            }`}
                          >
                            {display}
                          </span>
                          {!rowMasked && (
                            <span
                              className="absolute top-0.5 right-1 z-10 flex items-center gap-1 rounded-md bg-white/70 p-0.5 opacity-20 transition-opacity group-hover:opacity-100 focus-within:opacity-100 dark:bg-zinc-950/70"
                              onClick={(event) => event.stopPropagation()}
                            >
                              {has && (
                                <button
                                  type="button"
                                  className="rounded border border-zinc-300 bg-white/90 p-1 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:opacity-100 dark:border-zinc-600 dark:bg-zinc-950/80 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                                  title={`Copy ${key} from ${envName}`}
                                  onClick={() => {
                                    void copyToClipboard(val).then(() => {
                                      onToast(`${key} of ${envName} copied to clipboard`)
                                    })
                                  }}
                                >
                                  <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current" aria-hidden>
                                    <rect x="5" y="3" width="8" height="10" rx="1.5" strokeWidth="1.4" />
                                    <path d="M3.5 10.5H3A1.5 1.5 0 0 1 1.5 9V3A1.5 1.5 0 0 1 3 1.5h5A1.5 1.5 0 0 1 9.5 3v.5" strokeWidth="1.4" />
                                  </svg>
                                </button>
                              )}
                              <button
                                type="button"
                                className="rounded border border-zinc-300 bg-white/90 p-1 text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:opacity-100 dark:border-zinc-600 dark:bg-zinc-950/80 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:hover:text-white"
                                title={`${has ? 'Edit' : 'Add'} ${key} in ${envName}`}
                                onClick={() => setEditingCell({ slotId: slot.id, key, value: val })}
                              >
                                <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-none stroke-current" aria-hidden>
                                  <path d="M2 11.75V14h2.25L12.6 5.65 10.35 3.4 2 11.75Z" strokeWidth="1.3" />
                                  <path d="m9.85 3.9 2.25 2.25 1.1-1.1a1.6 1.6 0 0 0 0-2.25l-.2-.2a1.6 1.6 0 0 0-2.25 0l-.9.9Z" strokeWidth="1.3" />
                                </svg>
                              </button>
                            </span>
                          )}
                        </div>
                      )}
                      {style.leftBarGradient && (
                        <span
                          className="absolute inset-y-0 -left-0.5 w-1.5"
                          style={{ backgroundImage: style.leftBarGradient }}
                          aria-hidden
                        />
                      )}
                    </td>
                  )
                })}
              </tr>
            )
          })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
