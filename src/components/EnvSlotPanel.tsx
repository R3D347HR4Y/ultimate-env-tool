import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { EnvSlot } from '../types'
import { defaultEnvColor } from '../types'
import { copyToClipboard, downloadText, sanitizeFilename } from '../lib/download'
import { serializeEnvEntries } from '../lib/parseEnv'
import type { ParsedEnv } from '../lib/parseEnv'

type Props = {
  slot: EnvSlot
  parsed: ParsedEnv
  slotIndex: number
  onNameChange: (name: string) => void
  onColorChange: (color: string) => void
  onResetColor: () => void
  onRawChange: (raw: string) => void
  hideContents: boolean
  onClear: () => void
  onRemoveSlot?: () => void
  canRemove: boolean
}

export function EnvSlotPanel({
  slot,
  parsed,
  slotIndex,
  onNameChange,
  onColorChange,
  onResetColor,
  onRawChange,
  hideContents,
  onClear,
  onRemoveSlot,
  canRemove,
}: Props) {
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const hasContent = slot.rawText.trim().length > 0
  const [revealed, setRevealed] = useState(() => !hideContents || !hasContent)

  useEffect(() => {
    if (!hideContents || !hasContent) {
      setRevealed(true)
      return
    }
    if (document.activeElement !== textareaRef.current) {
      setRevealed(false)
    }
  }, [hasContent, hideContents])

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const f = e.dataTransfer.files[0]
      if (f) {
        void f.text().then((t) => onRawChange(t))
        return
      }
      const text = e.dataTransfer.getData('text/plain')
      if (text) onRawChange(text)
    },
    [onRawChange]
  )

  const onPickFile = () => fileRef.current?.click()

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) void f.text().then((t) => onRawChange(t))
    e.target.value = ''
  }

  const exportBody = serializeEnvEntries(parsed.entries)
  const defaultColor = defaultEnvColor(slotIndex)
  const entryCount = parsed.keyToLastEntry.size
  const isMasked = hideContents && hasContent && !revealed

  return (
    <div
      className="flex min-w-[260px] flex-1 flex-col gap-2 rounded-xl border bg-zinc-50/80 p-3 shadow-sm dark:bg-zinc-900/50"
      style={{ borderColor: `${slot.color}55`, boxShadow: `inset 0 3px 0 ${slot.color}` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-full ring-1 ring-black/10 dark:ring-white/10"
          style={{ backgroundColor: slot.color }}
          aria-hidden
        />
        <input
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm font-medium text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          value={slot.displayName}
          onChange={(e) => onNameChange(e.target.value)}
          aria-label={`Env name for ${slot.id}`}
          placeholder="Name this env..."
        />
        {canRemove && onRemoveSlot && (
          <button
            type="button"
            onClick={onRemoveSlot}
            className="rounded-lg border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            Remove
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400" htmlFor={`${id}-color`}>
          Env color
        </label>
        <input
          id={`${id}-color`}
          type="color"
          value={slot.color}
          onChange={(e) => onColorChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded border border-zinc-300 bg-white p-1 dark:border-zinc-600 dark:bg-zinc-950"
          aria-label={`Color for ${slot.displayName}`}
        />
        <code className="rounded bg-zinc-200 px-2 py-0.5 text-[11px] dark:bg-zinc-800">{slot.color}</code>
        <button
          type="button"
          onClick={onResetColor}
          className="rounded-lg border border-zinc-300 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
          title={`Reset to auto color ${defaultColor}`}
        >
          Auto
        </button>
      </div>

      <div
        className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 bg-white/50 px-3 py-6 text-center text-xs text-zinc-500 transition hover:bg-white/70 dark:border-zinc-600 dark:bg-zinc-950/50 dark:hover:bg-zinc-950/70"
        style={{ borderColor: `${slot.color}99` }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        onClick={onPickFile}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onPickFile()
          }
        }}
      >
        <span className="font-medium text-zinc-700 dark:text-zinc-300">Drop .env here</span>
        <span className="mt-1">or click to choose a file</span>
        <input
          ref={fileRef}
          id={`${id}-file`}
          type="file"
          accept=".env,.txt,text/plain,*/*"
          className="sr-only"
          onChange={handleFile}
        />
      </div>
      <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400" htmlFor={`${id}-ta`}>
        Paste contents
      </label>
      <div className="relative">
        <textarea
          ref={textareaRef}
          id={`${id}-ta`}
          className={`min-h-[140px] w-full resize-y rounded-lg border border-zinc-300 bg-white p-2 font-mono text-xs leading-relaxed text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100 ${
            isMasked ? 'blur-sm' : ''
          }`}
          value={slot.rawText}
          onChange={(e) => onRawChange(e.target.value)}
          onFocus={() => setRevealed(true)}
          onBlur={() => setRevealed(!hideContents || slot.rawText.trim().length === 0)}
          placeholder="# KEY=value"
          spellCheck={false}
        />
        {isMasked && (
          <button
            type="button"
            onClick={() => {
              setRevealed(true)
              requestAnimationFrame(() => textareaRef.current?.focus())
            }}
            className="absolute inset-0 flex min-h-[140px] w-full items-center justify-center rounded-lg border border-zinc-300 bg-white p-2 text-center dark:border-zinc-600 dark:bg-zinc-950"
            aria-label={`Reveal contents of ${slot.displayName}`}
          >
            <span className="rounded-full bg-zinc-200 px-3 py-1 text-[11px] font-medium tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              Hidden. Click to reveal.
            </span>
          </button>
        )}
      </div>
      <div className="mt-auto flex flex-wrap items-end justify-between gap-2">
        <button
          type="button"
          onClick={() => void copyToClipboard(exportBody)}
          className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-700 dark:bg-zinc-200 dark:text-zinc-900 dark:hover:bg-white"
        >
          Copy env
        </button>
        <button
          type="button"
          onClick={() => downloadText(sanitizeFilename(slot.displayName || `env-${slot.id}`), exportBody)}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-100 dark:hover:bg-zinc-800"
        >
          Download
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-400 dark:hover:bg-zinc-800"
        >
          Clear
        </button>
        <span className="ml-auto text-right text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
          {entryCount} {entryCount === 1 ? 'entry' : 'entries'}
        </span>
      </div>
    </div>
  )
}
