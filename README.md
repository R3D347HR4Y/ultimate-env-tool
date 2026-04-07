# Ultimate Env Tool

Compare, diff, and merge multiple **[`.env`](https://www.npmjs.com/package/dotenv)** (dotenv) files **in your browser**. Align keys across environments, inspect a side-by-side matrix, build a **hybrid merge** with configurable priority, rename keys everywhere, and optionally keep an **encrypted** backup in the browser—**no backend required** for normal use.

Created by **[Eliott Guillaumin](https://eliott.cloud)**.

---

## Features

- **Environment columns** — Paste, type, or drop each file into its own slot; name and color columns for local, staging, production, etc.
- **Comparison matrix** — Row/column view of every key; edit cells, copy values, rename a key across all envs at once; optional masking/hiding for screen sharing.
- **Row filters (legend)** — Filter the matrix by patterns such as same value on a subset of envs, unique to one env, all different, or missing on an env.
- **Hybrid env merge** — Choose **union** or **intersection** for which keys appear, enable/disable sources, drag to set **priority**; **first defined wins** per key for the merged output.
- **Optional persistence** — AES-256-GCM encrypted snapshot in `localStorage`; encryption key stays in tab memory until you close it. Export/import **`ultimate-env-tool.encrypted-archive.json`** when persistence is enabled.
- **Client-side first** — No account and no server for editing; data stays on your machine unless you opt into encrypted local storage.

---

## Tech stack

| Area        | Choice                          |
| ----------- | ------------------------------- |
| UI          | React 19, TypeScript            |
| Styling     | Tailwind CSS v4 (`@tailwindcss/vite`) |
| Build       | Vite 8                          |
| Tests       | Vitest                          |

---

## Requirements

- **Node.js** (LTS recommended) with **npm** (or compatible package manager).

---

## Getting started

```bash
npm install
npm run dev
```

The dev server defaults to **[http://localhost:5188](http://localhost:5188)** (see `vite.config.ts`).

### Scripts

| Command            | Description                    |
| ------------------ | ------------------------------ |
| `npm run dev`      | Start Vite in development mode |
| `npm run build`    | Typecheck + production build to `dist/` |
| `npm run preview`  | Serve the production build locally |
| `npm test`         | Run Vitest once                |
| `npm run test:watch` | Vitest watch mode          |
| `npm run lint`     | ESLint                         |

---

## Configuration

### `VITE_SITE_URL` (production builds)

For **canonical URLs**, **Open Graph / Twitter** image URLs, **`robots.txt`**, and **`sitemap.xml`**, set the public site origin **without** a trailing slash.

Copy the example file and adjust:

```bash
cp .env.example .env.production
```

Example `.env.production`:

```env
VITE_SITE_URL=https://your-domain.com
```

If unset, the build falls back to `http://localhost:5188` (fine for local previews; **set the real URL before shipping**).

Static SEO assets are emitted into `dist/` on build:

- `robots.txt`
- `sitemap.xml`

Additional head metadata and **JSON-LD** are injected from [`src/seo.ts`](src/seo.ts) via Vite’s `transformIndexHtml`.

---

## Project layout

```
├── public/           # Static assets (favicon, og-image, web manifest)
├── src/
│   ├── components/ # UI: matrix, slots, hybrid builder, legend, dialogs
│   ├── lib/        # Parsing, persistence, download helpers
│   ├── App.tsx     # Main app shell
│   ├── seo.ts      # Site name, descriptions (shared with build-time HTML)
│   └── main.tsx
├── index.html      # HTML shell with SEO placeholders
└── vite.config.ts  # Vite + Tailwind + HTML/robots/sitemap SEO pipeline
```

---

## Security & privacy

- **Default:** Nothing is uploaded; closing the tab discards in-memory state unless you enabled encrypted persistence.
- **Persistence:** Uses the Web Crypto API (**AES-256-GCM**). The passphrase-derived key is intended to exist only in that tab session; review the in-app disclaimer before enabling.

---

## License

This repository is marked **private** in `package.json`. Add a `LICENSE` file here if you intend to open-source the project.
