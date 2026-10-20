# Design prompt for a Claude desktop session

Paste everything below the line into a Claude desktop / Claude Design session so it designs against
the team's synced design system instead of generic components. Keep it in step with
`.design-sync/config.json` when components are added or renamed.

---

You are helping design and build UI for **WSM Security**, an internal Zoho Catalyst web app for the
ManageEngine WSM Security team. Always design against the team's own design system, not generic
components.

## The design system to use
- Claude Design project **"WSM Security"** (owner: Pk):
  https://claude.ai/design/p/8dfaa359-0b78-4055-abe5-47cff82b3233
  Attach / select this design system before producing any screen. It was synced from the app's
  real React code on 2026-10-20, so every component in it is one the engineers can ship as-is.
- Components available on `window.WSMSecurity` (21):
  - Icons (8, 14px stroke SVG, currentColor, no props): RefreshIcon, LayersIcon, CloseIcon,
    PlugIcon, ReauthIcon, BoltIcon, TrashIcon, UnplugIcon.
  - Shell (1): AuthGate — session gate; wraps the app, renders children(user).
  - Views (12, full-width screens): Home, Ask, CompareDpias, ComplianceConfig, Connections,
    DependencyNotifier, DmsDocuments, DraftRisk, FollowUps, GuidelinesView, GuidelinesLegend,
    RiskRegister. These are data-bound to the app's API, so in a design they show their
    loading/empty state; use them for layout fidelity, not for sample data.
- Prop contracts in the project are untyped (`[key: string]: unknown`). The real shapes:
  `onNotice: (message: string) => void` (ComplianceConfig, Connections, DependencyNotifier,
  FollowUps, RiskRegister); `user: { email, name, initials, role: 'admin' | 'member' }`
  (Home, Connections); `GuidelinesView: { text: string }`; `AuthGate: { children: (user) => node }`.

## Styling idiom (CSS custom properties + the app's own classes, no utility framework)
- Dark is the default ground ("nordic"); light is opt-in via `:root[data-theme="light"]`.
- Core tokens, use them with `var(--*)`: ground `--bg --chrome --surf --surf2`,
  lines `--line0 … --line4`, text `--ink --ink2 --ink3 --muted --muted2 --muted3`,
  accent (gold) `--ac --ac-hov --ac-hi --ac-soft --ac-tint --ac-text --on-ac`,
  second accent (electric) `--ac2 --ac2-text --ac2-tint --ac2-soft`,
  status `--sem-fail --sem-fail-soft --sem-fail-tint --sem-fail-line` (and the other sem-* tiers),
  type `--font` (Archivo, from Google Fonts) and `--font-mono`.
- Reuse existing class names from the app stylesheet (e.g. `.view-title`, `.tag`, `.tag-admin`,
  `.mono`, the `wsm-*` shell classes) before inventing new ones. Read the project's `styles.css`
  (it is the app's App.css plus the font import) to see the full vocabulary.

## Layout reference
- The current shell follows the "WSM Security v5" mockup: a collapsible left rail (236px open,
  46px closed) with brand block, grouped nav (Compliance Manager, Follow-ups, VM Manager) and a
  user footer, beside a main column of top bar + content. Settings is one screen with two tabs
  (Connections, Compliance). Breadcrumbs read `Module · Section`.

## Source of truth (if you have file access to the repo)
Repo: /Users/praveen-8915/otherProducts/wsm_security
- Tokens and classes: frontend/src/App.css
- Shell and routing: frontend/src/App.jsx
- Screens: frontend/src/views/*.jsx · gate: frontend/src/components/AuthGate.jsx · icons: frontend/src/lib/icons.jsx
- Mockups the app was built from: design/WSM Security v3|v4|v5.dc.html (v5 is current)
- Sync inputs and gotchas: .design-sync/config.json, .design-sync/NOTES.md, HANDOVER.md
Prefer reading these files over guessing. Do not modify them; design changes are proposed as
new screens or as diffs the engineer applies.

## Working rules
- New screens must sit inside the existing shell and use the tokens above; never hard-code colours.
- When a needed component does not exist in the system, say so explicitly and build it from the
  tokens and classes, flagged as "new component — not yet in the design system".
- Ask before producing anything that changes the shell, the nav groups, or the token palette.
