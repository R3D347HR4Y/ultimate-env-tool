import type { EnvSlot, HybridUniverse } from '../types'

export const PERSIST_STORAGE_KEY = 'env-compare.encrypted.v1'

export type AppStateSnapshot = {
  v: 1
  slots: EnvSlot[]
  alignKeys: boolean
  sortAsc: boolean
  hideEnvContents?: boolean
  hideTableContents?: boolean
  useFullWidth?: boolean
  legendCollapsed: boolean
  priorityOrder: string[]
  hybridEnabledIds?: string[]
  hybridUniverse: HybridUniverse
  /** Legend row filters. Omitted or empty = show all keys. */
  legendFilterIds?: string[]
  /** Persistent table widths in px. */
  tableWidths?: {
    keyColumnWidth?: number
    valueColumnWidth?: number
  }
}

type EncodedPayload = {
  v: 1
  ivB64: string
  dataB64: string
}

export function hasPersistedCipher(): boolean {
  try {
    return typeof localStorage !== 'undefined' && !!localStorage.getItem(PERSIST_STORAGE_KEY)
  } catch {
    return false
  }
}

export function readPersistedRaw(): string | null {
  try {
    return localStorage.getItem(PERSIST_STORAGE_KEY)
  } catch {
    return null
  }
}

export function writePersistedRaw(json: string): void {
  localStorage.setItem(PERSIST_STORAGE_KEY, json)
}

export function clearPersistedStorage(): void {
  try {
    localStorage.removeItem(PERSIST_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ''
  bytes.forEach((b) => {
    bin += String.fromCharCode(b)
  })
  return btoa(bin)
}

export function base64ToBytes(b64: string): Uint8Array | null {
  try {
    const t = b64.trim().replace(/\s+/g, '')
    const bin = atob(t)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  } catch {
    return null
  }
}

export function hexToBytes(hex: string): Uint8Array | null {
  const t = hex.trim().replace(/^0x/i, '').replace(/\s+/g, '')
  if (!/^[0-9a-fA-F]{64}$/.test(t)) return null
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(t.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

/** Accept 32-byte key as base64 (44 chars typical) or 64 hex chars. */
export function parseUserKeyMaterial(input: string): Uint8Array | null {
  const raw = input.trim()
  if (!raw) return null

  const hex = hexToBytes(raw)
  if (hex) return hex

  const from64 = base64ToBytes(raw)
  if (from64 && from64.length === 32) return from64

  return null
}

export function generateAes256KeyBytes(): Uint8Array {
  const k = new Uint8Array(32)
  crypto.getRandomValues(k)
  return k
}

export async function importAesGcmKey(raw32: Uint8Array): Promise<CryptoKey> {
  if (raw32.length !== 32) {
    throw new Error('AES-256 requires a 32-byte key')
  }
  const keyBytes = Uint8Array.from(raw32)
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function encryptSnapshot(key: CryptoKey, snapshot: AppStateSnapshot): Promise<string> {
  const iv = new Uint8Array(crypto.getRandomValues(new Uint8Array(12)))
  const plaintext = new TextEncoder().encode(JSON.stringify(snapshot))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, plaintext)
  )
  const payload: EncodedPayload = {
    v: 1,
    ivB64: bytesToBase64(iv),
    dataB64: bytesToBase64(ct),
  }
  return JSON.stringify(payload)
}

export async function decryptSnapshot(key: CryptoKey, rawJson: string): Promise<AppStateSnapshot> {
  let parsed: EncodedPayload
  try {
    parsed = JSON.parse(rawJson) as EncodedPayload
  } catch {
    throw new Error('Saved data is not valid JSON')
  }
  if (parsed.v !== 1 || !parsed.ivB64 || !parsed.dataB64) {
    throw new Error('Unrecognized saved data format')
  }
  const ivRaw = base64ToBytes(parsed.ivB64)
  const data = base64ToBytes(parsed.dataB64)
  if (!ivRaw || ivRaw.length !== 12 || !data) {
    throw new Error('Invalid ciphertext envelope')
  }
  const iv = new Uint8Array(ivRaw)
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, new Uint8Array(data))
  const snap = JSON.parse(new TextDecoder().decode(pt)) as AppStateSnapshot
  if (!snap || snap.v !== 1 || !Array.isArray(snap.slots)) {
    throw new Error('Invalid decrypted state')
  }
  return snap
}
