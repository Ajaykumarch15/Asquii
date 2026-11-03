# 01 — Repository audit

## Scope and evidence

Inspected the complete tracked source inventory visible in the checkout, including all files below `frontend/src`, package metadata, configs, README, and root files. No backend, database, migrations, Supabase config, tests, CI, deployment manifests, or environment templates were present in the discovered file list. `.git` and `.vite` are generated/metadata directories and are not product source. No dependency install or source edits were made.

## Structure

```text
.
├── .gitignore
├── gitbranches.md
└── frontend/
    ├── index.html
    ├── package.json / package-lock.json
    ├── vite.config.ts, tsconfig.json
    ├── tailwind.config.js, postcss.config.js
    └── src/
        ├── App.tsx, main.tsx, model.ts, styles.css
        ├── components/{AppShell,Header,Sidebar,ui,ComponentShowcase}.tsx
        └── modules/
            ├── workspace/pages/{Overview,Projects,People,Settings}Page.tsx
            ├── workspace/components/WorkspaceEditor.tsx
            └── projects/{pages/{Overview,People,Settings,Kanban,Tasks,Meetings,Resources}Page.tsx,
                         components/{ProjectPageComponents,ProjectEditors}.tsx}
```

## Verified stack

`frontend/package.json` declares React and React DOM `^18.3.1`, TypeScript `~5.6.2`, Vite `^6.0.5`, `@vitejs/plugin-react ^4.3.4`, Tailwind `^3.4.16`, PostCSS `^8.4.49`, Autoprefixer `^10.4.20`, lucide-react `^0.468.0`, and React type packages `^18.3.12` / `^18.3.1`. Lockfile is npm `package-lock.json`; exact resolved package versions should be taken from that lockfile when pinning. Scripts are `dev`, `build` (`tsc -b && vite build`), and `preview`. Vite config uses the React plugin. TypeScript is strict, ES2020, bundler module resolution, `noEmit`; Tailwind scans index and source. No router, query/cache client, form schema validator, UI framework, animation library, test runner, or backend SDK is declared.

## Architecture and behavior

`main.tsx` mounts the React app; `App.tsx` owns scope/page selection, workspace/persona/project selection, CRUD callbacks, derived notifications, and editor state. Page selection uses strings and conditional rendering (no URL router). `model.ts` defines domain types, seeded `DEFAULT_DATA`, validation/legacy migration, and `useAppData`, which reads/writes browser localStorage under `asquii.prototype.v8`. Other local keys persist active workspace, preview persona, theme, read notification IDs, and recent projects. This is single-browser persistence, not a shared backend.

`components/AppShell.tsx` composes `Header` and `Sidebar`, command palette, notification menu and workspace/project scope navigation. `components/ui.tsx` exports Button, TextInput, Select, Textarea, Badge, Avatar, AvatarGroup, Tabs, EmptyState, LoadingState, ErrorState, and StateMessage. The app has meaningful client interactions (CRUD-like local mutations, filtering, CSV import/export, board ordering, soft-delete resource trash, etc.), but no network data fetching is found.

## Audit findings and risks

- Seed records are realistic-looking names/emails and dates; they are prototype fixtures, not verified customers or production records.
- `personaId` switches among seeded people. It is not login, and frontend `canAdmin` checks are not security boundaries.
- Data is stored as one browser-local JSON aggregate with schema migration helpers; concurrent users/devices do not share changes.
- “Upload” stores file metadata in the local app; no binary upload/storage integration is present.
- UI project tabs include team concepts and an “On hold”/“Archived” project filter, but the model has no team entities and project status type does not include those values; treat those surfaces as UI affordances requiring verification, not implemented server concepts.
- No tests, production config, error monitoring, auth, API, RLS, backup, or deployment setup were discovered.
- Root `gitbranches.md` purpose is UNKNOWN without product/team context.

## Counts

There are 11 page components: four workspace screens and seven project screens. They are selected in two scope-aware conditional dispatchers. There are no addressable browser routes in this implementation. Reusable component count is not a stable metric because several page-local subcomponents are defined alongside exports; shared UI exports listed above are ten, plus shell/header/sidebar and editor components.

See screen inventory for exact names, and module analysis for mock-data classification.
