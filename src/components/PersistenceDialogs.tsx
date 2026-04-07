import { useEffect, useId, useRef, useState } from 'react'
import type { TextareaHTMLAttributes } from 'react'
import type { AppStateSnapshot } from '../lib/persistStorage'
import {
  bytesToBase64,
  clearPersistedStorage,
  decryptSnapshot,
  generateAes256KeyBytes,
  importAesGcmKey,
  parseUserKeyMaterial,
  readPersistedRaw,
} from '../lib/persistStorage'
import { copyToClipboard } from '../lib/download'

type UnlockProps = {
  open: boolean
  onUnlocked: (cryptoKey: CryptoKey, snapshot: AppStateSnapshot, rawCipher: string) => void
  onPurgeStorage: () => void
  allowClose?: boolean
  onClose?: () => void
}

export function UnlockDialog({ open, onUnlocked, onPurgeStorage, allowClose = false, onClose }: UnlockProps) {
  const id = useId()
  const fileRef = useRef<HTMLInputElement>(null)
  const [keyInput, setKeyInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [importedCipher, setImportedCipher] = useState<string | null>(null)
  const [importedFilename, setImportedFilename] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setKeyInput('')
      setError(null)
    }
  }, [open])

  if (!open) return null

  const submit = async () => {
    setError(null)
    const raw = parseUserKeyMaterial(keyInput)
    if (!raw) {
      setError('Enter a 32-byte key as Base64 or 64 hex characters.')
      return
    }
    const cipher = importedCipher ?? readPersistedRaw()
    if (!cipher) {
      setError('No encrypted save found. Import an archive or use a saved browser copy.')
      return
    }
    setBusy(true)
    try {
      const cryptoKey = await importAesGcmKey(raw)
      const snapshot = await decryptSnapshot(cryptoKey, cipher)
      onUnlocked(cryptoKey, snapshot, cipher)
    } catch {
      setError('Wrong key or corrupted save. Try again or purge storage.')
    } finally {
      setBusy(false)
    }
  }

  const purge = () => {
    clearPersistedStorage()
    setKeyInput('')
    setError(null)
    setImportedCipher(null)
    setImportedFilename(null)
    onPurgeStorage()
  }

  const pickArchive = () => fileRef.current?.click()

  const importArchive = async (file: File) => {
    setError(null)
    try {
      const text = await file.text()
      setImportedCipher(text)
      setImportedFilename(file.name)
    } catch {
      setError('Could not read the selected archive file.')
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <h2 id={`${id}-title`} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Enter encryption key
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          The key is only kept in memory after you unlock. You can use the encrypted browser copy already on this
          device or import an encrypted archive file. It is never stored in{' '}
          <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">localStorage</code> or{' '}
          <code className="rounded bg-zinc-100 px-1 text-xs dark:bg-zinc-800">sessionStorage</code>.
        </p>
        <div
          className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-zinc-300 bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-500 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-950 dark:hover:bg-zinc-900"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const file = event.dataTransfer.files[0]
            if (file) void importArchive(file)
          }}
          onClick={pickArchive}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              pickArchive()
            }
          }}
        >
          <span className="font-medium text-zinc-700 dark:text-zinc-300">Drop archive here</span>
          <span className="mt-1">or click to browse</span>
          {importedFilename && (
            <span className="mt-2 rounded bg-zinc-200 px-2 py-0.5 text-[11px] text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
              Imported: {importedFilename}
            </span>
          )}
          <input
            ref={fileRef}
            type="file"
            accept=".json,.enc,.txt,application/json,text/plain"
            className="sr-only"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void importArchive(file)
              event.target.value = ''
            }}
          />
        </div>
        <label className="mt-4 block text-xs font-medium text-zinc-700 dark:text-zinc-300" htmlFor={`${id}-key`}>
          Key (Base64 or hex)
        </label>
        <input
          id={`${id}-key`}
          name="current-password"
          type="password"
          className="mt-1 w-full rounded-lg border border-zinc-300 bg-white p-2 font-mono text-sm text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          placeholder="Paste the key you saved when you enabled persistence"
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore={false}
          data-lpignore="false"
        />
        {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
          {importedCipher && (
            <button
              type="button"
              onClick={() => {
                setImportedCipher(null)
                setImportedFilename(null)
                setError(null)
              }}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Clear imported archive
            </button>
          )}
          <button
            type="button"
            onClick={purge}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Purge encrypted storage
          </button>
          {allowClose && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-zinc-300 px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

type EnableProps = {
  open: boolean
  onClose: () => void
  onEnabled: (cryptoKey: CryptoKey) => void | Promise<void>
}

export function EnablePersistenceDialog({ open, onClose, onEnabled }: EnableProps) {
  const id = useId()
  const [generated, setGenerated] = useState(() => bytesToBase64(generateAes256KeyBytes()))
  const [useCustom, setUseCustom] = useState(false)
  const [customKey, setCustomKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setGenerated(bytesToBase64(generateAes256KeyBytes()))
      setUseCustom(false)
      setCustomKey('')
      setError(null)
    }
  }, [open])

  const regenerate = () => {
    setGenerated(bytesToBase64(generateAes256KeyBytes()))
    setError(null)
  }

  if (!open) return null

  const confirm = async () => {
    setError(null)
    const raw = useCustom ? parseUserKeyMaterial(customKey) : base64ToBytesStrict(generated)
    if (!raw) {
      setError(
        useCustom
          ? 'Custom key must be Base64 (32 bytes) or 64 hex characters.'
          : 'Invalid generated key—try Regenerate.'
      )
      return
    }
    setBusy(true)
    try {
      const cryptoKey = await importAesGcmKey(raw)
      await Promise.resolve(onEnabled(cryptoKey))
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not use this key')
    } finally {
      setBusy(false)
    }
  }

  const copyGenerated = () => void copyToClipboard(generated)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-en-title`}
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <h2 id={`${id}-en-title`} className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Enable persistence
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          A random AES-256 key is generated below. Copy it to a password manager—you will need it every time you open this app to load saved data. The key stays only in page memory after you continue; it is not written to storage.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-keymode`}
              checked={!useCustom}
              onChange={() => setUseCustom(false)}
            />
            Use generated key
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name={`${id}-keymode`}
              checked={useCustom}
              onChange={() => setUseCustom(true)}
            />
            Provide my own key
          </label>
        </div>

        {!useCustom ? (
          <>
            <label className="mt-3 block text-xs font-medium text-zinc-700 dark:text-zinc-300">Generated key (Base64)</label>
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <input
                readOnly
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-zinc-50 px-2 py-2 font-mono text-xs text-zinc-900 dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
                value={generated}
              />
              <button
                type="button"
                onClick={() => void copyGenerated()}
                className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white hover:bg-violet-500"
              >
                Copy key
              </button>
              <button
                type="button"
                onClick={regenerate}
                className="rounded-lg border border-zinc-300 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-600 dark:text-zinc-300"
              >
                Regenerate
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              id={`${id}-custom-hint`}
              className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-700 dark:border-zinc-600 dark:bg-zinc-950/80 dark:text-zinc-300"
            >
              <p className="font-medium text-zinc-800 dark:text-zinc-200">How to create a 32-byte key</p>
              <ul className="mt-2 list-inside list-disc space-y-1.5 marker:text-zinc-400">
                <li>
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">Password manager:</span> use the
                  generator with length <strong className="font-semibold">44</strong> and a character set that includes{' '}
                  <code className="rounded bg-zinc-200/80 px-1 font-mono text-[11px] dark:bg-zinc-800">A–Z</code>,{' '}
                  <code className="rounded bg-zinc-200/80 px-1 font-mono text-[11px] dark:bg-zinc-800">a–z</code>,{' '}
                  <code className="rounded bg-zinc-200/80 px-1 font-mono text-[11px] dark:bg-zinc-800">0–9</code>,{' '}
                  <code className="rounded bg-zinc-200/80 px-1 font-mono text-[11px] dark:bg-zinc-800">+</code>,{' '}
                  <code className="rounded bg-zinc-200/80 px-1 font-mono text-[11px] dark:bg-zinc-800">/</code>, and{' '}
                  <code className="rounded bg-zinc-200/80 px-1 font-mono text-[11px] dark:bg-zinc-800">=</code> (standard
                  Base64). Or generate <strong className="font-semibold">64</strong> random hex digits{' '}
                  <code className="rounded bg-zinc-200/80 px-1 font-mono text-[11px] dark:bg-zinc-800">0–9a–f</code>.
                </li>
                <li>
                  <span className="font-medium text-zinc-800 dark:text-zinc-200">CLI:</span>{' '}
                  <code className="rounded bg-zinc-200/80 px-1 font-mono text-[11px] dark:bg-zinc-800">
                    openssl rand -base64 32
                  </code>{' '}
                  (paste the single line, no spaces) or{' '}
                  <code className="rounded bg-zinc-200/80 px-1 font-mono text-[11px] dark:bg-zinc-800">
                    openssl rand -hex 32
                  </code>
                  .
                </li>
              </ul>
            </div>
            <label className="mt-3 block text-xs font-medium text-zinc-700 dark:text-zinc-300" htmlFor={`${id}-custom`}>
              Your key (Base64 32-byte or 64 hex chars)
            </label>
            <textarea
              id={`${id}-custom`}
              name="env-compare-aes256-key"
              className="mt-1 min-h-[88px] w-full rounded-lg border border-zinc-300 bg-white p-2 font-mono text-sm dark:border-zinc-600 dark:bg-zinc-950 dark:text-zinc-100"
              value={customKey}
              onChange={(e) => setCustomKey(e.target.value)}
              autoComplete="new-password"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              inputMode="text"
              aria-describedby={`${id}-custom-hint`}
              data-1p-ignore="false"
              data-lpignore="false"
              {...({
                passwordrules:
                  'minlength: 43; maxlength: 44; allowed: lower, upper, digit, [+], [/], [=];',
              } as TextareaHTMLAttributes<HTMLTextAreaElement>)}
              placeholder="e.g. output of openssl rand -base64 32"
            />
          </>
        )}

        {error && <p className="mt-2 text-sm text-rose-600 dark:text-rose-400">{error}</p>}

        <div className="mt-6 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
            className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy ? 'Saving…' : 'Save encrypted copy & turn on'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-600"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

function base64ToBytesStrict(b64: string): Uint8Array | null {
  try {
    const t = b64.trim().replace(/\s+/g, '')
    const bin = atob(t)
    if (bin.length !== 32) return null
    const out = new Uint8Array(32)
    for (let i = 0; i < 32; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}
