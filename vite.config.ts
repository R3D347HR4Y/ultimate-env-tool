import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'
import { seo } from './src/seo'

function normalizeSiteUrl(raw: string | undefined, fallback: string): string {
  const t = raw?.trim()
  if (!t) return fallback
  return t.replace(/\/$/, '')
}

function seoPipeline(mode: string): { siteUrl: string; canonical: string; ogImage: string; jsonLdStr: string } {
  const env = loadEnv(mode, process.cwd(), '')
  const siteUrl = normalizeSiteUrl(env.VITE_SITE_URL, 'http://localhost:5188')
  const canonical = `${siteUrl}/`
  const ogImage = `${siteUrl}/og-image.png`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebApplication',
    name: seo.siteName,
    description: seo.jsonLdDescription,
    url: canonical,
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Any',
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
    },
    author: {
      '@type': 'Person',
      name: seo.authorName,
      url: seo.authorUrl,
    },
  }
  const jsonLdStr = JSON.stringify(jsonLd).replace(/</g, '\\u003c')
  return { siteUrl, canonical, ogImage, jsonLdStr }
}

function injectHtml(html: string, mode: string): string {
  const { canonical, ogImage, jsonLdStr } = seoPipeline(mode)
  return html
    .replace(/__DOCUMENT_TITLE__/g, seo.documentTitle)
    .replace(/__META_DESCRIPTION__/g, seo.metaDescription)
    .replace(/__CANONICAL_URL__/g, canonical)
    .replace(/__OG_IMAGE__/g, ogImage)
    .replace(/__SITE_NAME__/g, seo.siteName)
    .replace(/__THEME_COLOR__/g, seo.themeColor)
    .replace(/__JSON_LD__/g, jsonLdStr)
}

function ultimateEnvSeoPlugin(mode: string): Plugin {
  let outDir = 'dist'

  return {
    name: 'ultimate-env-seo',
    configResolved(config) {
      outDir = config.build.outDir
    },
    transformIndexHtml(html) {
      return injectHtml(html, mode)
    },
    closeBundle() {
      const { siteUrl, canonical } = seoPipeline(mode)
      const root = resolve(process.cwd(), outDir)
      writeFileSync(
        resolve(root, 'robots.txt'),
        `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n`
      )
      writeFileSync(
        resolve(root, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          `  <url>\n` +
          `    <loc>${canonical}</loc>\n` +
          `    <changefreq>weekly</changefreq>\n` +
          `    <priority>1.0</priority>\n` +
          `  </url>\n` +
          `</urlset>\n`
      )
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ultimateEnvSeoPlugin(mode)],
  /** Use a non-default port so other Vite apps (e.g. SvelteKit on 5173) do not share the same origin in stale browser tabs. */
  server: {
    port: 5188,
    strictPort: false,
  },
  test: {
    environment: 'node',
  },
}))
