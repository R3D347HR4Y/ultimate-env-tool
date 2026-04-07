export const seo = {
  siteName: 'Ultimate Env Tool',
  shortName: 'Ultimate Env',
  documentTitle: 'Ultimate Env Tool — Compare & merge .env files in your browser',
  metaDescription:
    'Compare and merge .env files in your browser: matrix diff, hybrid merge, optional encrypted local backup. Client-side; no API.',
  jsonLdDescription:
    'Ultimate Env Tool compares and merges dotenv (.env) files in the browser with a value matrix, row filters, hybrid merge by priority, and optional AES-256-GCM encrypted persistence. AGPL-3.0; built by Eliott Guillaumin.',
  /** Public source — safe to audit and run locally */
  sourceRepoUrl: 'https://github.com/R3D347HR4Y/ultimate-env-tool',
  authorName: 'Eliott Guillaumin',
  authorUrl: 'https://eliott.cloud',
  themeColor: '#09090b',
} as const

/** Short hero line (visible on the page; keep compact for layout + scanning) */
export const heroTagline =
  'Compare, diff, and merge multiple .env files in your browser—matrix view, hybrid merge, and optional encrypted backup.'

/** Secondary hero detail (persistence / crypto one-liner) */
export const heroDetail =
  'By default everything stays in memory in this tab. If you turn on persistence, backups are AES-256-GCM encrypted in this browser and the key never leaves the tab until you close it.'
