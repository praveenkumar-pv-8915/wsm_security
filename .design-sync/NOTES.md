# design-sync notes — wsm_security → Claude Design "WSM Security"

Repo-specific gotchas for the next sync. Config lives in `config.json` beside this file.

- **This is an app, not a library.** `frontend/` has no dist/, no `.d.ts`, no `main`/`module`.
  The bundle is built from the hand-written barrel `.design-sync/entry.jsx` (passed as `--entry`),
  and the component list comes entirely from `componentSrcMap` in config.json. Add a new component
  in BOTH places. The converter's own synth entry uses `export *`, which silently drops the views'
  `export default` — that is why the barrel exists.
- **PKG_DIR is the repo root** (walk-up from the entry lands on the root package.json,
  `wsm-security`), so every path in config.json is repo-root-relative and `srcDir` is `frontend/src`.
  `--node-modules` must be `frontend/node_modules` (where react/axios live).
- **CSS is pre-assembled.** Run `node .design-sync/build-css.mjs` before the converter: it writes
  `.design-sync/.cache/ds-styles.css` = Google Fonts Archivo `@import` + `frontend/src/App.css`.
  The app loads Archivo via a `<link>` in `frontend/index.html`, which no CSS scrape can see.
  Validate reports `[FONT_REMOTE] "Archivo"` — expected, served at runtime.
- **Groups come from doc stubs.** `.design-sync/docs/<Name>.md` with `category:` frontmatter sets the
  card group (Icons, Shell); the views group themselves from their `views/` directory.
  `[DOCS_UNMAPPED]` for the 12 views is expected until stubs are written for them.
- **`[DTS_REACT]` warning is harmless here.** dts.mjs looks for `@types/react` walking up from
  PKG_DIR (repo root); it is only in `frontend/node_modules`. There are no `.d.ts` to resolve
  anyway — every `<Name>Props` is `[key: string]: unknown`. Real shapes, for a future `dtsPropsFor`:
  `onNotice: (message: string) => void` (ComplianceConfig, Connections, DependencyNotifier,
  FollowUps, RiskRegister); `user: { email; name; initials; role: 'admin' | 'member' }` (Home,
  Connections); `GuidelinesView: { text: string }`; `AuthGate: { children: (user) => ReactNode }`;
  icons and the remaining views take no props.
- **Views are data-bound screens.** They fetch `/server/welcome/api/*` on mount and AuthGate needs
  the Catalyst SDK, so outside the app they render loading/error states. Expect `[GRID_OVERFLOW]`
  on them if previews are ever authored (`overrides.<Name>.cardMode = "column"`).
- **Node v20.20.2, npm, no lockfile in frontend/** → `npm install`, not `npm ci`.

## Browser / render check

- No Playwright browser is cached on this Mac. The installed Google Chrome 155 launches via
  `DS_CHROMIUM_PATH` but closes the CDP connection immediately (`Target page, context or browser
  has been closed`, then `kill EPERM`), so it cannot drive the render check.
- **2026-10-20 first sync: the user chose to skip verification entirely** ("no need to implement
  anything, just sync"). Uploaded with `--no-render-check`; no previews authored; all 21 components
  ship the floor card. Nothing has been machine-rendered.

## Known render warns

- None recorded — the render check has never run.

## Re-sync risks

- **Nothing is verified.** The first thing a future sync with a browser should do is
  `cd .ds-sync && npx playwright install chromium`, then run validate without `--no-render-check`.
- `.design-sync/.cache/ds-styles.css` is a build artifact (gitignored); a fresh clone must run
  `build-css.mjs` or the converter reports `! cssEntry: ... not found` and ships no CSS.
- The Archivo font depends on fonts.googleapis.com being reachable at design-render time.
- `App.css` is copied wholesale (86 KB, ~70 tokens + every app class). Any App.css change moves the
  styleSha and re-ships the stylesheet; that is correct, not drift.
- No `conventions.md` / `readmeHeader` yet — the design agent gets only the generated README.
  Authoring one (tokens `--bg/--surf/--ink/--ac*`, dark default, `:root[data-theme="light"]`) is
  the highest-value follow-up.
