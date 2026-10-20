# Handover: /design-sync of wsm_security frontend → Claude Design project "WSM Security"

## Context
Repo: /Users/praveen-8915/otherProducts/wsm_security (Zoho Catalyst app; React/Vite app in frontend/,
NOT a component library). On 2026-10-20 the user ran `/design-sync` and chose to sync frontend/
anyway as a package-shape design system. The skill lives at
/private/tmp/claude-502/bundled-skills/2.1.304/9b3f332487c6ad962e1f9e159746479f/design-sync
(base SKILL.md + non-storybook/SKILL.md). Re-read both before continuing; follow them from §3 onward.

Start by telling the user: "Standalone Claude Design (claude.ai/design) closes by December 14, 2026.
Claude Design now lives in Claude." (the skill requires this line first).

## Status 2026-10-20 — FIRST SYNC COMPLETE (unverified)
Uploaded 92 files (21 components, bundle, styles, README, sentinel, _ds_sync.json anchor) to the
project below via the atomic path; `list_files` confirmed the count. The user chose to skip the
render check and preview authoring ("no need to implement anything, just sync"), so every
component ships the floor card and nothing has been machine-rendered. Follow-ups, in value order:
(1) author `.design-sync/conventions.md` + `readmeHeader`; (2) `dtsPropsFor` from the shapes
below; (3) install Playwright Chromium and run the render check; (4) author previews for the
core set. Re-sync = fetch `_ds_sync.json` to `.design-sync/.cache/remote-sync.json`, then the
driver command in NOTES.md with `--remote` pointing at it.

## Target project (created 2026-10-20, pinned, now populated)
- Name: WSM Security · projectId: 8dfaa359-0b78-4055-abe5-47cff82b3233
- URL: https://claude.ai/design/p/8dfaa359-0b78-4055-abe5-47cff82b3233
- First upload done 2026-10-20 (see Status). Sync inputs committed; see .design-sync/NOTES.md.
- Pinned in .design-sync/config.json. Because the pin pre-dates the new run, the base skill §1
  router says a pinned project takes the ATOMIC path (upload once at the end after everything is
  verified) — follow that rule rather than the incremental one.

## Decisions the user already made (don't re-ask)
1. Sync frontend/ as a package-shape DS, all 21 exports.
2. Preview scope = "core set": author previews for the 8 icons + GuidelinesLegend + GuidelinesView;
   floor cards for the 11 data-bound views and AuthGate.
3. Browser for the render check: the user approved installing Playwright's Chromium, then
   interrupted asking why. It was explained (not Google Chrome; Playwright's headless build into
   ~/.cache/ms-playwright; the installed Chrome 155 launches but drops the CDP connection and
   can't be used via DS_CHROMIUM_PATH). **Confirm the choice before downloading**: install
   (`cd .ds-sync && npx playwright install chromium`), or validate with --no-render-check and
   report the bundle as machine-unverified, or stop.

## What exists on disk (committed 2026-10-20)
Durable, to be committed later (minimal one-line commit message, ≤256 chars, NO Co-Authored-By or
session trailers — project CLAUDE.md rule):
- .design-sync/config.json — projectId, shape=package, pkg=wsm-security, globalName=WSMSecurity,
  entry=.design-sync/entry.jsx, srcDir=frontend/src, buildCmd="node .design-sync/build-css.mjs",
  cssEntry=.design-sync/.cache/ds-styles.css, docsDir=.design-sync/docs, componentSrcMap
  enumerating all 21 components (required: there is no .d.ts, so names come only from the map).
- .design-sync/entry.jsx — hand-written barrel re-exporting the 13 default-exported components,
  GuidelinesLegend, and `export *` from frontend/src/lib/icons.jsx. (The converter's synth entry
  uses `export *`, which drops default exports — that is why the barrel exists.)
- .design-sync/build-css.mjs — writes .design-sync/.cache/ds-styles.css = Google Fonts Archivo
  @import + frontend/src/App.css (the app loads Archivo via <link> in index.html, invisible to CSS
  scraping). Run it before every converter build.
- .design-sync/docs/*.md — 9 stubs (8 icons category Icons, AuthGate category Shell) with a
  one-line description each; they set the group and feed .prompt.md.
- .gitignore — appended: .ds-sync/, ds-bundle/, .design-sync/.cache/, .design-sync/learnings/,
  .design-sync/node_modules
Gitignored machine state:
- .ds-sync/ — staged converter scripts + npm deps esbuild, ts-morph, @types/react, playwright
  (package only; no browser downloaded).
- ds-bundle/ — a clean build: 21 components in groups icons/, shell/, views/; _ds_bundle.js 195 KB;
  styles.css → _ds_bundle.css (86 KB) with the Archivo @import first; _ds_sync.json anchor present.

## Build/validate commands (run from repo root)
    node .design-sync/build-css.mjs
    node .ds-sync/package-build.mjs --config .design-sync/config.json \
         --node-modules frontend/node_modules --entry .design-sync/entry.jsx --out ./ds-bundle
    node .ds-sync/package-validate.mjs ./ds-bundle
Current validate result: everything passes except `[RENDER_SKIPPED]` (no usable browser).
[FONT_REMOTE] Archivo is informational (served by Google Fonts at runtime). Node v20.20.2.

## Known gaps to fix next
- Prop contracts are `[key: string]: unknown` for every component (JSX, no types). Add
  `dtsPropsFor` to config using the real shapes already dug out of the source:
    onNotice: (message: string) => void   (ComplianceConfig, Connections, DependencyNotifier,
                                           FollowUps, RiskRegister)
    user: { email: string; name: string; initials: string; role: 'admin' | 'member' }  (Home, Connections)
    GuidelinesView: { text: string }
    AuthGate: { children: (user: User) => React.ReactNode }
    Ask, CompareDpias, DmsDocuments, DraftRisk, GuidelinesLegend, the 8 icons: no props.
- [DTS_REACT] warns because dts.mjs looks for @types/react walking up from PKG_DIR (repo root);
  it is in frontend/node_modules only. Harmless here (no .d.ts to resolve), but note it in NOTES.md.
- [DOCS_UNMAPPED] for the 12 views: either add stubs in .design-sync/docs or accept synthesized
  prompt.md. Views fetch /server/welcome/api/* on mount, so previews will show loading/error states.
- Views are full-width screens: expect [GRID_OVERFLOW]; apply overrides.<Name>.cardMode="column".

## Remaining skill steps, in order
1. Settle the browser question → get validate to exit 0 (render check or --no-render-check with
   explicit user sign-off recorded in NOTES.md).
2. §4.2–4.3: author .design-sync/previews/<Name>.tsx for the 10 scoped components, rebuild,
   `node .ds-sync/package-capture.mjs --out ./ds-bundle`, grade cells to
   .design-sync/.cache/review/<Name>.grade.json until all `good`.
3. §4.4: serve `node .ds-sync/storybook/http-serve.mjs ./ds-bundle` (background, timeout 7200000)
   and have the user review .review.html.
4. §4.5: DesignSync report_validate with the .render-check.json counts.
5. Author .design-sync/conventions.md (tokens from App.css: --bg/--surf/--ink/--ac ramp etc.,
   class vocabulary, dark default with :root[data-theme="light"]), set readmeHeader, then rebuild
   via the DRIVER: `node .ds-sync/resync.mjs --config .design-sync/config.json
   --node-modules frontend/node_modules --entry .design-sync/entry.jsx --out ./ds-bundle`
   (first sync: no --remote).
6. §5 atomic upload: finalize_plan (localDir ./ds-bundle, full writes list, deletes []),
   sentinel → content → sentinel re-arm → _ds_sync.json last; list_files to confirm.
7. Write .design-sync/NOTES.md (gotchas above + a "Re-sync risks" section), then commit the
   durable set (.design-sync/* that isn't gitignored, .gitignore). Pushing needs a terminal.

## Repo rules that apply
- Global: ask for approval before any file/command change; suggest, never auto-apply, memory edits.
- Project: minimal commit messages, no attribution trailers; deploy/test rules don't apply here
  (nothing in the Catalyst app changed — only sync inputs were added).
- DesignSync tool must be loaded with ToolSearch("select:DesignSync") before use.
