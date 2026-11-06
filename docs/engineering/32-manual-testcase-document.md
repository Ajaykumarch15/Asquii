# 32 — Manual testcase document (frontend integration)

- **Branch:** `frontend/integration`
- **Baseline commit:** `ade1079` (People/Settings sidebar routing) — 2026-11-06
- **Scope:** the React + Vite frontend integrated with the live FastAPI + Supabase backend, plus the anonymous landing page and the offline prototype demo.
- **Execution model:** manual, in the browser. No automated test run is part of this document. `npx tsc --noEmit` remains the only automated gate in the frontend.

## 1. Purpose

This document is a step-by-step regression script for the integrated frontend. It is written so that each case can be executed independently and marked Pass, Fail, or Blocked. It covers:

1. Environment and data prerequisites.
2. The anonymous landing page and the opt-in prototype demo (including browser history).
3. Authentication (sign-in, sign-up, sign-out, session persistence).
4. The real workspace home, People page, Settings page, and project detail.
5. Meetings with attendees and the activity feed.
6. Role-based negative cases (Member / non-member).
7. Cross-cutting regression (prototype vs real data, themes, known limitations).

**Out of scope:** backend unit/integration tests (already green: 69 passed, 15 skipped), API contract tests by curl, load/performance testing, accessibility audits beyond basic keyboard checks.

## 2. Test environment

| Component | Value | How to start |
|---|---|---|
| Frontend | `http://localhost:5173` | `cd frontend` → `npm run dev` |
| Backend API | `http://127.0.0.1:8000` (docs at `/docs`) | `cd backend` → activate `.venv` → `uvicorn app.main:app --reload` |
| Database | Supabase Postgres, migrations at head | `alembic current` → `0005_rls_lock_read_relaxations (head)` |
| Browser | Chrome or Edge, normal (non-private) profile | — |

**Preconditions for the whole run**

1. `backend/.env` exists with the development Supabase/DB values. The app reads it as UTF-8 (a BOM is tolerated); if the API refuses to start, check the file encoding first.
2. `GET http://127.0.0.1:8000/health` returns 200.
3. `GET http://127.0.0.1:8000/ready` returns 200 (database reachable). A 503 here means the DB URL or pooler configuration is wrong — fix the environment before testing features.
4. `alembic current` reports `0005_rls_lock_read_relaxations (head)`.
5. The frontend loads at `http://localhost:5173` with no build error overlay.

### 2.1 Test accounts

| Alias | Email | Password | Role / state |
|---|---|---|---|
| **Owner** | `1521ajay@gmail.com` | `password` | Owner of "Smoke Workspace 1793806974" |
| **Non-member** | `asquii-smoke-2@gmail.com` | `password` | Valid Supabase user, **not** a workspace member (as of the baseline) |
| **Second member** | invite a mailbox you control | — | Created through the invite flow to test Member/Admin behavior |

> The Owner account is the only workspace member left after the Sprint 11e self-removal test. Several cases below need a second person. Before the run, sign in as **Owner**, go to **People → Invite person**, invite `asquii-smoke-2@gmail.com` as **Member**, copy the token link, sign in as **Non-member**, open the link, and accept. This also exercises the invite flow itself (TC-PEOPLE-15/16).

### 2.2 Data fixtures

| Fixture | Value |
|---|---|
| Workspace | "Smoke Workspace 1793806974" — `3637b952-08a3-4488-914d-4a85d1306819` |
| Project | "Integration Test Project" — `a392192e-cf5a-4736-a92c-8a3877ca9ee6` |
| Meetings | "Sprint check-in", "RLS smoke meeting" (both 0 attendees at baseline) |
| Prototype demo store | `asquii.prototype.v8` (localStorage, browser-only) |
| Session store | `asquii.auth.session` (Supabase session), plus `asquii.*` UI preferences |

### 2.3 Clean start / reset

1. Sign out in the app (or clear the session).
2. DevTools → Application → Local Storage → delete every key starting with `asquii.` (this also clears the demo store and theme).
3. Reload `http://localhost:5173/` and confirm the landing page appears.

> Deleting `asquii.*` is destructive for demo data and preferences but never touches the backend.

### 2.4 Known quirks (do not raise as defects)

- **Transient "Session expired…"**: the first load after a long idle can show this once; reload and sign in again. Only report it if it repeats after a successful sign-in.
- **Invitation token shown once**: the token is returned only in the creation response. If it is lost, revoke the invitation and create another.
- **No per-person notifications**: the workspace activity feed is the notification surface by design.
- **Sidebar navigation is state-based**: only landing ↔ demo uses browser history entries. Browser Back from People/Settings/Overview is not expected to walk the sidebar history (see §10.4).
- **Meeting agenda is plain text**: line breaks are preserved, but there is no rich-text formatting.

## 3. Conventions

### 3.1 Priorities

| Priority | Meaning |
|---|---|
| **Critical** | Data loss, auth bypass, real/prototype data mixing, or a completely broken primary flow |
| **High** | A documented feature does not work for an allowed role |
| **Medium** | Incorrect state, stale UI, or a broken secondary action |
| **Low** | Copy, spacing, theme polish |

### 3.2 Recording results

Each case ends with:

- `Result:` — tick **Pass**, **Fail**, or **Blocked**
- `Notes:` — one line: what differed, the URL, the account used, and any console/network error. "Blocked" means a prerequisite failed; record which one.

### 3.3 Progress tracker

Fill the counts at the end of the run.

| Section | Cases | Pass | Fail | Blocked |
|---|---|---|---|---|
| 4. Environment (`TC-ENV`) | 4 |  |  |  |
| 5. Landing page (`TC-LAND`) | 11 |  |  |  |
| 6. Demo & history (`TC-DEMO`) | 10 |  |  |  |
| 7. Authentication (`TC-AUTH`) | 10 |  |  |  |
| 8. Workspace home (`TC-HOME`) | 12 |  |  |  |
| 9. People page (`TC-PEOPLE`) | 18 |  |  |  |
| 10. Settings page (`TC-SET`) | 7 |  |  |  |
| 11. Project detail (`TC-PROJ`) | 10 |  |  |  |
| 12. Meetings & attendees (`TC-MEET`) | 13 |  |  |  |
| 13. Role negatives (`TC-NEG`) | 7 |  |  |  |
| 14. Cross-cutting (`TC-REG`) | 8 |  |  |  |
| **Total** | **110** |  |  |  |

## 4. Environment (`TC-ENV`)

### TC-ENV-01 — Servers are reachable

**Priority:** Critical · **Preconditions:** repo on `frontend/integration`, dependencies installed

| # | Action | Expected result |
|---|---|---|
| 1 | Start the backend (`uvicorn app.main:app --reload`). | Process starts without traceback; `Uvicorn running on http://127.0.0.1:8000`. |
| 2 | Open `http://127.0.0.1:8000/health`. | HTTP 200 with a healthy status payload. |
| 3 | Open `http://127.0.0.1:8000/ready`. | HTTP 200; a 503 means the database is unreachable — record it and stop the run. |
| 4 | Start the frontend (`npm run dev`) and open `http://localhost:5173/`. | Landing page renders; no Vite error overlay; browser console has no uncaught errors. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-ENV-02 — Database is at the expected migration head

**Priority:** Critical · **Preconditions:** backend venv active, DB reachable

| # | Action | Expected result |
|---|---|---|
| 1 | In `backend/`, run `alembic current`. | Reports `0005_rls_lock_read_relaxations (head)`. |
| 2 | Run `alembic heads`. | Exactly one head, the same revision. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-ENV-03 — Anonymous baseline is clean

**Priority:** High · **Preconditions:** `asquii.*` storage cleared

| # | Action | Expected result |
|---|---|---|
| 1 | Open `http://localhost:5173/`. | Landing page, not the app shell. |
| 2 | Check the URL. | No `#demo`, no `?invite=`. |
| 3 | DevTools → Local Storage. | No `asquii.auth.session`; no real workspace identifiers. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-ENV-04 — Reset between test runs

**Priority:** Medium · **Preconditions:** signed in

| # | Action | Expected result |
|---|---|---|
| 1 | Sign out from the header account menu. | Landing page appears. |
| 2 | Clear all `asquii.*` keys in Local Storage and reload. | Landing page; theme back to default; no demo progress. |
| 3 | Sign in again. | Real workspace home loads with the workspace card. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

## 5. Landing page (`TC-LAND`)

> All cases in this section assume the visitor is signed out and `asquii.*` storage is cleared unless stated otherwise.

### TC-LAND-01 — Landing is the anonymous default route

**Priority:** Critical · **Preconditions:** signed out, clean URL

| # | Action | Expected result |
|---|---|---|
| 1 | Open `http://localhost:5173/`. | Standalone landing page renders. |
| 2 | Observe the layout. | No app sidebar, no workspace switcher, no prototype "Product & Engineering" data. |
| 3 | Reload. | The landing page renders again (no auto-entry into the demo). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-LAND-02 — Landing top bar

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Inspect the top bar. | Asquii wordmark with the "A" tile, "Asquii" text, and a "Workspace OS" badge. |
| 2 | Inspect the right side. | Theme toggle icon, **Sign in** button, **Create account** button. |
| 3 | Resize to 360 px width. | Top bar stays usable; buttons remain visible; no horizontal scroll. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-LAND-03 — Hero content

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Read the headline. | Exactly: "Plan the work. Meet the people. Ship the project." |
| 2 | Read the subtitle. | Mentions workspaces, projects, tasks, meetings and resources, and signing in vs the sample demo. |
| 3 | Inspect the CTAs. | **Get started** (primary) and **Explore the demo mock** (secondary). |
| 4 | Read the small print under the CTAs. | Explains the demo uses sample data stored in this browser only. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-LAND-04 — "Live backend" badge is gone

**Priority:** Low

| # | Action | Expected result |
|---|---|---|
| 1 | Inspect the area directly above the headline. | No "Live backend · Supabase auth" badge. |
| 2 | Confirm the headline starts close under the top bar. | No large empty band between the header and the headline. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-LAND-05 — Hero scaling and decorative fill

**Priority:** Low

| # | Action | Expected result |
|---|---|---|
| 1 | View at ≥1280 px width. | Headline is very large (up to `xl:text-8xl`), balanced across 2–3 lines, not clipped. |
| 2 | View at 768 px and 360 px. | Type scales down (6xl → 4xl); no overlap with the top bar; no horizontal scrollbar. |
| 3 | Observe the space around the headline. | Soft brand-tinted blurred orbs are visible behind/around the hero (theme-aware; subtle in both themes). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-LAND-06 — "Get started" opens registration

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Get started**. | Modal opens with the title "Create your account". |
| 2 | Close the modal, click **Create account** in the top bar. | Same modal, same mode. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-LAND-07 — "Sign in" opens sign-in

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Sign in** in the top bar. | Modal opens with the title "Sign in to Asquii". |
| 2 | Click the "Create an account" link inside the modal. | Modal switches to "Create your account" without closing. |
| 3 | Click "Sign in" inside the modal. | Modal switches back to "Sign in to Asquii". |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-LAND-08 — Feature cards

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Scroll to the feature grid. | Four cards: Projects & milestones, Tasks & subtasks, Meetings & attendees, People & roles. |
| 2 | Read each body. | Copy matches the implemented behavior (roles, attendee management, invitation email validation). |
| 3 | Resize the window. | Grid reflows 1 → 2 → 4 columns without overflow. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-LAND-09 — How it works and footer

**Priority:** Low

| # | Action | Expected result |
|---|---|---|
| 1 | Scroll to "How it works". | Four numbered steps: Create a workspace, Add projects and tasks, Invite your team, Follow the activity. |
| 2 | Click the **Sign in** button in that panel. | Sign-in modal opens. |
| 3 | Inspect the footer. | Asquii wordmark and the one-line product description. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-LAND-10 — Invitation banner appears only with a token

**Priority:** High · **Preconditions:** a pending invitation token is available

| # | Action | Expected result |
|---|---|---|
| 1 | Open `http://localhost:5173/?invite=INVALID-TOKEN`. | Banner "You have a workspace invitation" appears under the hero CTAs. |
| 2 | Confirm the copy. | Directs the visitor to sign in or create an account with the **invited email**; acceptance is validated against that address. |
| 3 | Click **Sign in to accept**. | Sign-in modal opens. |
| 4 | Open `http://localhost:5173/` without the query. | No invitation banner. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-LAND-11 — Theme toggle on the landing page

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Click the theme toggle. | The page switches between light and dark; all sections stay readable. |
| 2 | Reload. | The chosen theme persists. |
| 3 | Sign in. | The app uses the same theme (no flash of the other theme after load). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

## 6. Demo mode and history (`TC-DEMO`)

> The demo is opt-in per browser session and uses the prototype store (`asquii.prototype.v8`). It must never read or write real backend data.

### TC-DEMO-01 — Entering the demo

**Priority:** High · **Preconditions:** signed out on the landing page

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Explore the demo mock**. | The prototype app shell opens (sidebar, header, mock workspace "Product & Engineering"). |
| 2 | Check the URL. | Ends with `#demo`. |
| 3 | Check the data on screen. | Prototype sample data (Ava, mock projects), not the Smoke Workspace. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-DEMO-02 — Demo badge and in-app exit

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Inspect the header next to the wordmark. | A "Demo" badge is visible at ≥640 px width. |
| 2 | Locate the exit control on the right. | "Back to landing" button (text hidden below 640 px, icon-only with an accessible label). |
| 3 | Click **Back to landing**. | The landing page returns. |
| 4 | Confirm the URL. | `#demo` is removed. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-DEMO-03 — Browser Back leaves the demo

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | From the landing page, click **Explore the demo mock**. | Demo opens with `#demo`. |
| 2 | Click the browser **Back** button once. | The landing page returns; no demo UI remains. |
| 3 | Click **Back** again. | The browser leaves the app or returns to the previous site (no broken intermediate state). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-DEMO-04 — Browser Forward re-enters the demo

**Priority:** High · **Preconditions:** completed TC-DEMO-03 step 2

| # | Action | Expected result |
|---|---|---|
| 1 | Click the browser **Forward** button. | The demo shell re-opens with `#demo`. |
| 2 | Confirm the sidebar and header. | Demo badge and "Back to landing" are present again. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-DEMO-05 — In-app exit and browser Back stay coherent

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Enter the demo, then use the in-app **Back to landing**. | Landing page returns. |
| 2 | Press browser **Forward**. | Demo re-opens (the exit used the real history stack). |
| 3 | Press browser **Back**. | Landing page returns again. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-DEMO-06 — Reload does not re-enter the demo

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Enter the demo (`#demo` present). | Demo shell. |
| 2 | Reload the tab. | Landing page appears; the demo does **not** auto-open. |
| 3 | Confirm the URL. | `#demo` has been normalized away. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-DEMO-07 — Stale `#demo` URL on a fresh load

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Open `http://localhost:5173/#demo` directly in a new tab (signed out). | Landing page, not the demo. |
| 2 | Check the URL after load. | The hash is removed. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-DEMO-08 — Demo navigation still has distinct pages

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | In the demo, open sidebar **Overview**. | Prototype workspace overview (not the landing page). |
| 2 | Open sidebar **People** (workspace scope). | Prototype workspace People page. |
| 3 | Open a project, then sidebar **People** (project scope). | Prototype **project** People page (different content from step 2). |
| 4 | Use the sidebar "… overview" link. | Returns to the workspace overview. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-DEMO-09 — Demo data stays local

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | In the demo, create or edit something (e.g. a task). | The UI updates. |
| 2 | Open DevTools → Network. | No requests to the backend API for that mutation (demo is offline). |
| 3 | Check Local Storage. | Prototype data under `asquii.prototype.v8`; no real workspace identifiers added. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-DEMO-10 — Signing in from the demo enters the real app

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | From inside the demo, click **Sign in** in the header. | Sign-in modal opens. |
| 2 | Sign in as **Owner**. | Real workspace home loads (Smoke Workspace card, real projects). |
| 3 | Check the URL. | No `#demo` hash. |
| 4 | Sign out. | Landing page (demo does not auto-resume). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

## 7. Authentication (`TC-AUTH`)

> All cases use the `AuthPanel` modal. There are no dedicated `/login` or `/register` routes yet.

### TC-AUTH-01 — Required fields block empty submits

**Priority:** Medium · **Preconditions:** signed out on the landing page

| # | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in modal and click **Sign in** with both fields empty. | Browser validation prevents submission; no network request; no crash. |
| 2 | Enter an email but no password and submit. | Submission blocked with a password-required validation message. |
| 3 | Enter a password but no email and submit. | Submission blocked with an email-required validation message. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-AUTH-02 — Wrong password shows a friendly error

**Priority:** Critical · **Preconditions:** sign-in modal open

| # | Action | Expected result |
|---|---|---|
| 1 | Enter `1521ajay@gmail.com` and password `wrong-password`. | — |
| 2 | Click **Sign in**. | An inline error ("Try again" state) appears; the modal stays open; the user is not signed in. |
| 3 | Correct the password to `password` and submit. | Sign-in succeeds and the modal closes. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-AUTH-03 — Password minimum length on sign-up

**Priority:** Medium · **Preconditions:** sign-up modal open ("Create your account")

| # | Action | Expected result |
|---|---|---|
| 1 | Enter a fresh email and password `short`. | — |
| 2 | Submit. | An inline error explains the password is too short (Supabase minimum is 8 characters); no account is created. |
| 3 | Enter a password of at least 8 characters and submit. | The request proceeds (see TC-AUTH-05). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-AUTH-04 — Sign-up with an existing email

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Open sign-up and enter `1521ajay@gmail.com` with a valid password. | — |
| 2 | Submit. | No second account is created. Depending on Supabase email-confirmation settings, the UI shows either an explicit error or the generic "Check your email" message; record which. |
| 3 | Sign in with the original credentials. | The original account still works; workspace data is intact. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-AUTH-05 — Create a new account

**Priority:** High · **Preconditions:** a mailbox you control; sign-up modal open

| # | Action | Expected result |
|---|---|---|
| 1 | Enter a new unique email and a valid password (≥ 8 characters). | — |
| 2 | Submit. | Either the user is signed in directly, or the "Check your email" success state appears (confirmation enabled). Record which path the project uses. |
| 3 | If confirmation is required, follow the email link, then sign in. | Sign-in succeeds. |
| 4 | Observe the post-sign-in screen. | A signed-in user with no workspace sees the first-run "Create your first workspace" path, not the landing page. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-AUTH-06 — Owner sign-in lands on the real workspace

**Priority:** Critical · **Preconditions:** signed out

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Sign in** and enter `1521ajay@gmail.com` / `password`. | Modal closes. |
| 2 | Observe the screen. | Real workspace home with the "Smoke Workspace 1793806974" card and real projects. |
| 3 | Confirm no prototype data. | No "Product & Engineering" mock workspace, no Ava persona. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-AUTH-07 — Session survives reload

**Priority:** High · **Preconditions:** signed in as Owner

| # | Action | Expected result |
|---|---|---|
| 1 | Reload the tab. | The app restores the session and shows the real workspace home (no landing page flash that requires re-auth). |
| 2 | Check Local Storage. | `asquii.auth.session` is present. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-AUTH-08 — Sign-out returns to the landing page

**Priority:** High · **Preconditions:** signed in

| # | Action | Expected result |
|---|---|---|
| 1 | Open the account menu in the header and choose **Sign out**. | The landing page appears. |
| 2 | Check the URL and hash. | No `#demo`, no session-bound state. |
| 3 | Check the sidebar. | No app shell; only the landing page. |
| 4 | Reload. | Landing page remains (session cleared). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-AUTH-09 — Modal close behavior

**Priority:** Low

| # | Action | Expected result |
|---|---|---|
| 1 | Open the sign-in modal and click the **X**. | Modal closes; landing page remains interactive. |
| 2 | Re-open and click the dimmed backdrop. | Modal closes. |
| 3 | Re-open, switch to sign-up, close, and re-open from **Sign in**. | The modal opens in sign-in mode (mode and errors reset per open). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-AUTH-10 — Invitation query survives sign-in

**Priority:** High · **Preconditions:** a pending invitation token for the signed-in account's email

| # | Action | Expected result |
|---|---|---|
| 1 | Open `http://localhost:5173/?invite=<token>` signed out. | Landing page with the invitation banner. |
| 2 | Sign in with the invited email. | The app opens the real workspace home; the `?invite=<token>` query is still in the URL. |
| 3 | Observe the home. | The "You have a workspace invitation" block with **Accept invitation** is shown (acceptance tested in TC-PEOPLE-15). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

## 8. Workspace home (`TC-HOME`)

> Signed-in cases assume the **Owner** account unless stated otherwise. The signed-in home is the "home" section of `RealWorkspaceHome`: workspace card → settings → people → invitations → projects → activity.

### TC-HOME-01 — Workspace card

**Priority:** Critical · **Preconditions:** signed in as Owner

| # | Action | Expected result |
|---|---|---|
| 1 | Open the app (Overview). | Workspace card shows the briefcase tile, workspace name "Smoke Workspace 1793806974", and `asquii.com/<slug>`. |
| 2 | Check the badges. | The current role badge reads **Owner**. |
| 3 | Check the invitations badge. | "No pending invitations" or "N pending invitation(s)" consistent with the invitation list. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-HOME-02 — Home sections and order

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Scroll the home. | Sections appear in order: Workspace settings, People, Invitations, Projects, Recent activity. |
| 2 | Confirm the activity note. | The footer of the feed states it is the workspace notification surface and that there is no per-person inbox yet. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-HOME-03 — Projects list

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Inspect the Projects section heading. | Shows "Projects (N)" with N matching the list. |
| 2 | Inspect "Integration Test Project". | Status badge, progress, and milestone summary render; the row offers an **Open** button. |
| 3 | Confirm empty state handling. | With zero projects, "No projects yet" appears instead of a blank area. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-HOME-04 — New project is Owner/Admin only

**Priority:** Critical

| # | Action | Expected result |
|---|---|---|
| 1 | As Owner, inspect the Projects header. | **New project** button is present. |
| 2 | Sign in as the invited Member. | The button is absent. |
| 3 | As Member, attempt `POST /api/v1/workspaces/{wid}/projects` with a valid token (optional, Swagger). | Backend returns 403 (authorization stays server-side). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-HOME-05 — Create a project with automatic progress

**Priority:** High · **Preconditions:** Owner or Admin

| # | Action | Expected result |
|---|---|---|
| 1 | Click **New project**. | Inline form appears with Name, Description, Status, Progress mode. |
| 2 | Enter a unique name, a short description, status **Active**, progress **Automatic (from tasks)**. | — |
| 3 | Click **Create project**. | The form closes; the new project appears in the list; a success notice appears. |
| 4 | Open the project and check Members. | The creator is the **Project Manager**. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-HOME-06 — Create a project with manual progress

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Click **New project**, choose progress **Manual**. | A "Manual progress (%)" input appears. |
| 2 | Set 40% and submit with a unique name. | The project is created and shows 40% progress in the list. |
| 3 | Set the input to 150 (if possible via keyboard). | The value clamps to 100 (or the field refuses the value) and the payload never exceeds 100. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-HOME-07 — Open a project from the home

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Open** on "Integration Test Project". | The real project detail page opens. |
| 2 | Use the back button in the project header. | Returns to the project list. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-HOME-08 — Activity feed first page

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Scroll to **Recent activity**. | The newest events are listed (8 by default) with actor, action text, timestamp, and resource-type badge. |
| 2 | Inspect the header badge. | Shows "Newest 8 of N" when more events exist. |
| 3 | Compare with a known recent action. | An action you just performed (e.g. project created) appears at/near the top. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-HOME-09 — Activity feed "Load more"

**Priority:** High · **Preconditions:** more than 8 activity events

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Load more (N older)**. | The list grows by another page (8 → 16); the button label counts down. |
| 2 | Repeat until fewer than one page remains. | The button disappears when all events are loaded. |
| 3 | Confirm no duplicates. | No event appears twice across pages. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-HOME-10 — Rename the workspace from the home

**Priority:** Medium · **Preconditions:** Owner or Admin

| # | Action | Expected result |
|---|---|---|
| 1 | In **Workspace settings**, change the name and click **Save name**. | The card heading and sidebar workspace name update; a success notice appears. |
| 2 | Reload. | The new name persists. |
| 3 | Inspect the slug line. | The slug is unchanged (`asquii.com/<old-slug>`), per the stable-slug rule. |
| 4 | Restore the original name. | Saves successfully. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-HOME-11 — First-run workspace creation

**Priority:** High · **Preconditions:** a signed-in account with **no** workspace membership (use a fresh sign-up or the non-member before accepting an invite)

| # | Action | Expected result |
|---|---|---|
| 1 | Sign in. | First-run state: "Create your first workspace" with a name field. |
| 2 | Submit an empty name. | Blocked by required-field validation. |
| 3 | Enter a unique workspace name and click **Create workspace**. | The workspace is created; the user is its Owner; the home loads with the new workspace card. |
| 4 | Confirm the slug. | A slug was generated from the name at creation. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-HOME-12 — Workspace switcher / create from the shell

**Priority:** Medium · **Preconditions:** signed in with at least two workspaces (create a throwaway one if needed)

| # | Action | Expected result |
|---|---|---|
| 1 | Open the workspace switcher in the header. | Both workspaces are listed with the current one marked. |
| 2 | Switch to the other workspace. | The home reloads for that workspace; projects, people, and activity match it. |
| 3 | Choose **Create workspace** from the switcher. | The workspace editor opens; creating one adds it and selects it. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

## 9. People page (`TC-PEOPLE`)

> This section verifies the sidebar routing fix (`c28d958`) plus member/invitation management. "People page" means the signed-in sidebar **People** entry, which renders the members list and invitations — not the workspace home.

### TC-PEOPLE-01 — Sidebar People opens the People page

**Priority:** Critical · **Preconditions:** signed in as Owner

| # | Action | Expected result |
|---|---|---|
| 1 | Click **People** in the sidebar. | The People page opens: "People (N)" member list followed by "Invitations". |
| 2 | Confirm it is not the home. | The Workspace settings, Projects, and Recent activity sections are **not** present. |
| 3 | Confirm the workspace card is still shown. | The workspace name/slug/role badges remain at the top for context. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-02 — People is highlighted in the sidebar

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | With People open, inspect the sidebar. | **People** has the active style; **Overview** does not. |
| 2 | Click **Overview**. | The home returns and **Overview** becomes active. |
| 3 | Click **People** again. | The People page returns; the highlight follows. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-03 — Members list contents

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Inspect each member row. | Initials avatar, display name, job title (or "No title yet"). |
| 2 | Locate the signed-in user. | The row is marked "(you)". |
| 3 | Check the count in the heading. | "People (N)" matches the number of rows. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-04 — Role editing is Owner-only

**Priority:** Critical · **Preconditions:** Owner + at least one Admin and one Member

| # | Action | Expected result |
|---|---|---|
| 1 | As Owner, inspect an **Admin** row and a **Member** row. | Both show a role dropdown (Member/Admin). |
| 2 | Inspect the Owner's own row. | Shows a static **Owner** badge, no dropdown. |
| 3 | Sign in as an **Admin** and open People. | No role dropdowns anywhere; roles render as static badges. |
| 4 | Sign in as a **Member** and open People. | No role dropdowns; no invite controls. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-05 — Role change persists

**Priority:** High · **Preconditions:** Owner; a Member to promote

| # | Action | Expected result |
|---|---|---|
| 1 | Change the Member's role to **Admin**. | The row updates; a success notice appears. |
| 2 | Reload. | The role is still Admin; the role badge updates. |
| 3 | Confirm the new Admin can now invite people. | Sign in as that user: People shows **Invite person**. |
| 4 | Demote back to **Member** as Owner. | Succeeds; reload confirms. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-06 — Owner cannot remove themselves

**Priority:** Critical

| # | Action | Expected result |
|---|---|---|
| 1 | As Owner, inspect your own row. | No **Leave** or **Remove** button (ownership moves only via transfer). |
| 2 | As Owner, inspect Admin/Member rows. | **Remove** is available. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-07 — Owner removes an Admin

**Priority:** High · **Preconditions:** Owner; a disposable Admin

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Remove** on the Admin row. | A confirmation dialog appears naming the member and explaining access loss. |
| 2 | Cancel. | Nothing changes. |
| 3 | Confirm. | The row disappears; the count decrements; a success notice appears; a `workspace.member_removed`-style event appears in the activity feed. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-08 — Owner removes a Member

**Priority:** High · **Preconditions:** Owner; a disposable Member

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Remove** on the Member row and confirm. | The member is removed; the list updates. |
| 2 | Sign in as the removed user. | They no longer see the workspace or its data. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-09 — Admin removes a Member but not an Admin

**Priority:** High · **Preconditions:** an Admin and a Member

| # | Action | Expected result |
|---|---|---|
| 1 | Sign in as the **Admin** and open People. | Member rows show **Remove**; Admin rows do not. |
| 2 | Remove the Member and confirm. | Succeeds; the list updates. |
| 3 | Inspect another Admin's row. | No **Remove** button. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-10 — Self-leave for Admin/Member

**Priority:** High · **Preconditions:** signed in as a non-Owner member with at least one other workspace or the ability to rejoin

| # | Action | Expected result |
|---|---|---|
| 1 | Inspect your own row. | A **Leave** button is shown. |
| 2 | Click **Leave**. | A confirmation dialog warns that access is lost until re-invited. |
| 3 | Confirm. | You are removed; the app leaves the workspace (other workspace or first-run state). |
| 4 | Sign in again. | The workspace is no longer listed for that account. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-11 — Invite person form

**Priority:** High · **Preconditions:** Owner or Admin; People page

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Invite person**. | Inline form with **Email**, **Role** (Member/Admin), and **Create invitation**. |
| 2 | Submit an invalid email. | Browser validation blocks submission. |
| 3 | Submit a valid email as **Member**. | The form closes; an "Invitation for … is ready." panel shows the token with **Copy token**; the pending badge increments. |
| 4 | Confirm the token is shown once. | It is not retrievable from the list afterwards; the list row shows email, status, role, created/expiry dates. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-12 — Copy and revoke an invitation

**Priority:** High · **Preconditions:** a pending invitation

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Copy token** on the creation panel. | The button flips to "Copied" and the clipboard contains the token. |
| 2 | In the invitations list, click **Revoke** on the pending invitation. | A confirmation dialog appears; on confirm the row disappears and the pending count decrements. |
| 3 | Open the copied link. | Acceptance fails (revoked/expired), with a clear error — no membership is created. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-13 — Member view of invitations

**Priority:** Medium · **Preconditions:** signed in as Member

| # | Action | Expected result |
|---|---|---|
| 1 | Open People. | Invitations list is visible (read-only). |
| 2 | Confirm controls. | No **Invite person**, no **Revoke**, no role dropdowns. |
| 3 | If there are no invitations. | "No invitations" empty state explains that workspace admins invite teammates. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-14 — Pending invitation badge stays in sync

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Create an invitation. | The workspace card badge changes to "1 pending invitation". |
| 2 | Revoke it. | Badge returns to "No pending invitations". |
| 3 | Accept an invitation as another user, then reload as Owner. | The accepted invitation no longer counts as pending; the new member appears in People. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-15 — Accept an invitation (matching email)

**Priority:** Critical · **Preconditions:** a pending token for the **Non-member** account's email

| # | Action | Expected result |
|---|---|---|
| 1 | Sign out, then open `http://localhost:5173/?invite=<token>`. | Landing page with the invitation banner. |
| 2 | Sign in as `asquii-smoke-2@gmail.com` / `password`. | Home loads; the "You have a workspace invitation" block is shown. |
| 3 | Click **Accept invitation**. | A success notice appears; the workspace joins the switcher; the role matches the invited role. |
| 4 | Open People as the new member. | The account appears in the members list with "(you)". |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-16 — Accept an invitation with the wrong email

**Priority:** Critical · **Preconditions:** a pending token created for a different email; signed in as another account

| # | Action | Expected result |
|---|---|---|
| 1 | Open `http://localhost:5173/?invite=<token-for-other-email>`. | The invitation banner appears (the token exists). |
| 2 | Click **Accept invitation** (or submit after signing in). | The server rejects it with an error message; no membership is created. |
| 3 | Check the workspace list. | The workspace was **not** added. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-17 — People page reload keeps the route

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Open People and reload the tab. | The app restores the signed-in session and shows the home (Overview), because the route is state-based — record the actual behavior. |
| 2 | Navigate to People again. | Works as in TC-PEOPLE-01. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PEOPLE-18 — People page error handling

**Priority:** Medium · **Preconditions:** DevTools can block the API (offline throttling or request blocking)

| # | Action | Expected result |
|---|---|---|
| 1 | Block `GET …/members` and open People. | "People could not be loaded" error state with **Retry**. |
| 2 | Unblock the request and click **Retry**. | The member list loads. |
| 3 | Block the invitations endpoint instead. | "Invitations could not be loaded" error state with its own **Retry**; the member list still renders. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

## 10. Settings page (`TC-SET`)

> The sidebar **Workspace settings** entry renders the "settings" section of `RealWorkspaceHome` (workspace card + Workspace settings only). This is the routing fixed in `ade1079`.

### TC-SET-01 — Settings entry visibility

**Priority:** Critical

| # | Action | Expected result |
|---|---|---|
| 1 | Sign in as **Owner** and inspect the sidebar bottom. | **Workspace settings** is visible. |
| 2 | Sign in as **Admin**. | **Workspace settings** is visible. |
| 3 | Sign in as **Member**. | The Settings entry is not rendered. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-SET-02 — Settings opens the settings page, not the home

**Priority:** Critical · **Preconditions:** Owner or Admin

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Workspace settings** in the sidebar. | The page shows the workspace card and the **Workspace settings** section (rename form; archive card for the Owner). |
| 2 | Confirm the page scope. | People, Invitations, Projects, and Recent activity are **not** rendered. |
| 3 | Inspect the sidebar highlight. | **Workspace settings** is highlighted; **Overview** is not. |
| 4 | Click **Overview**. | The full home returns. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-SET-03 — Rename from the settings page

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Change the workspace name and click **Save name**. | Success notice; the card heading and sidebar name update. |
| 2 | Reload and reopen Settings. | The new name persists; the slug line is unchanged. |
| 3 | Clear the name. | **Save name** is disabled; submitting is impossible. |
| 4 | Restore the original name. | Saves successfully. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-SET-04 — Name length limit

**Priority:** Low

| # | Action | Expected result |
|---|---|---|
| 1 | Paste a name longer than 120 characters. | The input caps at 120 characters (or the save is rejected with a clear message). |
| 2 | Save a valid name. | Succeeds; no truncation mismatch between UI and server. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-SET-05 — Archive workspace (destructive)

**Priority:** High · **Preconditions:** use a **disposable** workspace you created for this test; Owner account

| # | Action | Expected result |
|---|---|---|
| 1 | Open Settings and locate the archive card. | Copy explains it hides the workspace from every member, revokes pending invitations, and cannot be undone in the app. |
| 2 | Click **Archive workspace**. | A confirmation dialog appears. |
| 3 | Cancel. | Nothing changes. |
| 4 | Click again and confirm. | Success notice; the workspace disappears from the switcher/home; pending invitations are revoked. |
| 5 | Reload. | The archived workspace is not listed; its data is not accessible. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-SET-06 — Archive is Owner-only

**Priority:** Critical · **Preconditions:** Admin account

| # | Action | Expected result |
|---|---|---|
| 1 | Sign in as **Admin** and open Settings. | The rename form is available. |
| 2 | Inspect the archive card. | **Archive workspace** is not rendered for Admins. |
| 3 | Optional API check: `POST …/workspaces/{id}/archive` with the Admin token. | Backend returns 403. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-SET-07 — Members cannot reach settings

**Priority:** High · **Preconditions:** Member account

| # | Action | Expected result |
|---|---|---|
| 1 | Sign in as **Member** and inspect the sidebar. | No Settings entry. |
| 2 | Manually trigger the route if possible (e.g. DevTools state edit). | The settings controls do not render for non-admins; server rejects mutations. |
| 3 | Optional API check: `PATCH …/workspaces/{id}` with the Member token. | 403. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

## 11. Project detail (`TC-PROJ`)

> Open "Integration Test Project" from the Projects route or from the home **Open** button. Tabs: Tasks, Meetings, Resources, Members, Milestones.

### TC-PROJ-01 — Project detail loads and navigates back

**Priority:** Critical · **Preconditions:** signed in as Owner

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Projects** in the sidebar. | The real project list opens (not the prototype project page). |
| 2 | Open "Integration Test Project". | Detail page loads with the project name, status/progress, and the tab bar. |
| 3 | Click the back arrow in the project header. | Returns to the project list. |
| 4 | Open the project from the home **Open** button. | Same detail page. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PROJ-02 — Tab set

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Inspect the tab bar. | Tasks, Meetings, Resources, Members, Milestones. |
| 2 | Switch through each tab. | Each renders its panel without console errors; loading states resolve. |
| 3 | Members tab. | Lists project members and the milestone count; states that adding/removing members lands in a later slice. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PROJ-03 — Task list and status filter

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Open the Tasks tab. | Tasks render with title, status, priority, assignee/due where present. |
| 2 | Choose a status in the **Status** filter. | Only matching tasks remain; the empty state mentions the filter. |
| 3 | Clear the filter. | All tasks return. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PROJ-04 — Create a task

**Priority:** High · **Preconditions:** project collaborator (Project Manager or Member)

| # | Action | Expected result |
|---|---|---|
| 1 | Click **New task**. | Form with Title, Status, Priority (and assignee fields where supported). |
| 2 | Enter a unique title, status **To do**, priority **High**, and submit. | The task appears in the list; a success notice appears. |
| 3 | Reload. | The task persists. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PROJ-05 — Change a task status

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Use the status select on a task row. | The task moves to the chosen status; the list/filter reflects it. |
| 2 | Reload. | The status persists. |
| 3 | Check the activity feed (home). | A `task.updated`-style event appears. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PROJ-06 — Task deletion is manager-only

**Priority:** Critical

| # | Action | Expected result |
|---|---|---|
| 1 | As **Project Manager**, locate the delete control on a disposable task. | Delete is available; confirming removes the task. |
| 2 | As a **Project Member** (not manager), inspect the same row. | No delete control. |
| 3 | Optional API check: `DELETE …/tasks/{id}` with a Member token. | 403 (server-side authorization). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PROJ-07 — Subtasks and comments

**Priority:** Medium · **Preconditions:** a task you can edit

| # | Action | Expected result |
|---|---|---|
| 1 | Expand a task and add a subtask. | The subtask appears unchecked. |
| 2 | Toggle the subtask checkbox. | It becomes done; the state persists after reload. |
| 3 | Remove the subtask. | It disappears. |
| 4 | Add a comment. | The comment appears with your name and timestamp. |
| 5 | Delete your comment. | It disappears (soft delete on the server). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PROJ-08 — Add a resource

**Priority:** High · **Preconditions:** project collaborator

| # | Action | Expected result |
|---|---|---|
| 1 | Open Resources and click **Add resource**. | Form with Name, Type (Document/Spreadsheet/Design file/Folder/Link), Category, Link URL, Detail. |
| 2 | Enter a name, type **Link**, a category, and a valid URL; submit. | The resource appears with its type badge and clickable URL. |
| 3 | Reload. | The resource persists. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PROJ-09 — Star and delete a resource

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Click the star on a resource. | It fills (★) and sorts above unstarred resources. |
| 2 | Reload. | The star state persists for your user. |
| 3 | Delete a disposable resource. | It disappears from the active list. |
| 4 | Confirm in the backend that the row is soft-deleted (optional). | `deleted_at` set; history retained. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-PROJ-10 — Milestones

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | As Project Manager, open Milestones. | The create form (Milestone name, Due date, **Add milestone**) is visible. |
| 2 | Add a milestone with a future due date. | It appears sorted by due date; the Members tab count increments. |
| 3 | As a non-manager project member, open Milestones. | The list is read-only; no create form. |
| 4 | Optional API check: `POST …/milestones` as a non-manager. | 403. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

## 12. Meetings and attendees (`TC-MEET`)

> Meetings live in the project detail → Meetings tab. Management = Project Manager **or** workspace Owner/Admin. Attendees may always remove themselves.

### TC-MEET-01 — Schedule a meeting

**Priority:** High · **Preconditions:** project collaborator

| # | Action | Expected result |
|---|---|---|
| 1 | Click **New meeting**. | Form: Title, Starts at (datetime), Type, Duration (minutes), Description, Agenda. |
| 2 | Fill a unique title, a future start, type **Standup**, 30 minutes, a description, and an agenda. | — |
| 3 | Click **Schedule meeting**. | The meeting appears in the list with type badge, date/time, duration, and "0 attendees". |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-MEET-02 — Meeting ordering and record fields

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Schedule a second meeting earlier/later than the first. | The list stays sorted by start time (earliest first). |
| 2 | Inspect a record. | Title, type badge, description (clamped), start, duration, attendee count, organizer (when activity allows). |
| 3 | Check the empty state. | With no meetings: "No meetings" with the collaborator/read-only variant. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-MEET-03 — Edit a meeting

**Priority:** High · **Preconditions:** manager (PM or Owner/Admin)

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Edit** on a meeting. | The form opens pre-filled with every current value ("Editing meeting"). |
| 2 | Change only the title. | — |
| 3 | Click **Save changes**. | The list updates; other fields are unchanged. |
| 4 | Optional network check. | The PATCH body contains only the changed field(s). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-MEET-04 — Agenda is displayed and persists

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Edit a meeting and enter a multi-line Agenda (include a line break). | — |
| 2 | Save. | The meeting card shows an "Agenda" block under the description; the line break is preserved. |
| 3 | Reopen **Edit**. | The same agenda is pre-filled. |
| 4 | Clear the agenda and save. | The Agenda block disappears from the card and the edit form is empty. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-MEET-05 — Attendee panel loads lazily

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Attendees** on a meeting. | Loading state, then the attendee chips (or "No attendees yet"). |
| 2 | Click **Hide attendees**, then reopen. | The panel collapses and reopens; no duplicate requests or flicker beyond the loader. |
| 3 | Check the count. | "N attendees" on the card matches the number of chips. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-MEET-06 — Manager adds an attendee

**Priority:** Critical · **Preconditions:** manager; at least one active project member who is not an attendee

| # | Action | Expected result |
|---|---|---|
| 1 | Expand Attendees and choose a project member. | The add control lists only active project members not already attending. |
| 2 | Add the member. | A chip appears; the count increments; a success notice appears. |
| 3 | Reload and re-expand. | The attendee persists. |
| 4 | Check the home activity feed. | A `meeting.attendee_added` event appears. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-MEET-07 — Add list excludes non-project-members

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Ensure a workspace member exists who is **not** on the project roster. | — |
| 2 | Expand the attendee add control. | That person is not offered. |
| 3 | Optional API check: add them directly. | 422 "All attendees must be active members of this project". |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-MEET-08 — Member cannot manage attendees

**Priority:** Critical · **Preconditions:** signed in as a project Member who is not a manager

| # | Action | Expected result |
|---|---|---|
| 1 | Expand Attendees on a meeting. | Chips are visible; there is no add control. |
| 2 | Check the empty-state copy. | It states a manager adds attendees. |
| 3 | Optional API check: `POST …/attendees` with the Member token. | 403. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-MEET-09 — Attendee removes themselves

**Priority:** Critical · **Preconditions:** signed in as an attendee (non-manager)

| # | Action | Expected result |
|---|---|---|
| 1 | Expand Attendees and locate your chip (marked "(you)"). | A remove/leave control is available to you. |
| 2 | Click it. | The chip disappears immediately (optimistic), then the count decrements. |
| 3 | Reload. | You are no longer an attendee. |
| 4 | Check the activity feed. | `meeting.attendee_removed` event. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-MEET-10 — Manager removes another attendee

**Priority:** High · **Preconditions:** manager; a meeting with ≥ 2 attendees

| # | Action | Expected result |
|---|---|---|
| 1 | As manager, remove another attendee's chip. | The chip disappears; the count decrements. |
| 2 | Reload. | The removal persists. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-MEET-11 — Duplicate attendee is prevented

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Confirm an attendee's chip is not offered again in the add control. | The add list excludes current attendees. |
| 2 | Optional API check: POST the same user twice. | 409 "User is already an attendee". |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-MEET-12 — Delete a meeting

**Priority:** High · **Preconditions:** manager; a disposable meeting

| # | Action | Expected result |
|---|---|---|
| 1 | Click **Delete** on the meeting. | A confirmation dialog appears. |
| 2 | Cancel. | The meeting remains. |
| 3 | Confirm. | The meeting disappears; attendees are removed with it (cascade). |
| 4 | Reload. | The meeting is still gone. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-MEET-13 — Meeting permissions matrix

**Priority:** Critical

| # | Action | Expected result |
|---|---|---|
| 1 | As **Project Manager**, inspect a meeting. | Edit and Delete are available. |
| 2 | As workspace **Owner/Admin** who is not the PM, inspect a meeting. | Edit and Delete are available (administrative override). |
| 3 | As a project **Member** (non-manager), inspect a meeting. | No Edit or Delete; Attendees is visible; self-removal only. |
| 4 | Optional API checks with Member token. | PATCH/DELETE return 403. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

## 13. Role-based negatives (`TC-NEG`)

> Run these after the positive cases so the state is warm. Use the **Non-member** account (`asquii-smoke-2@gmail.com`) before it is invited, or remove it from the workspace first.

### TC-NEG-01 — Non-member sees no workspace data

**Priority:** Critical · **Preconditions:** signed-in account with no membership

| # | Action | Expected result |
|---|---|---|
| 1 | Sign in as the non-member. | First-run state ("Create your first workspace") — not another user's workspace. |
| 2 | Inspect the sidebar. | No projects, no People, no activity from the Smoke Workspace. |
| 3 | Optional API check: `GET /api/v1/workspaces`. | Only workspaces the account belongs to (empty list), never the Smoke Workspace. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-NEG-02 — Member cannot create projects

**Priority:** Critical

| # | Action | Expected result |
|---|---|---|
| 1 | As Member, open Overview/Projects. | No **New project** control. |
| 2 | Optional API check. | POST returns 403. |
| 3 | As Owner, confirm project creation still works. | Yes. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-NEG-03 — Member cannot invite or revoke

**Priority:** Critical

| # | Action | Expected result |
|---|---|---|
| 1 | As Member, open People. | No **Invite person**, no **Revoke**. |
| 2 | Optional API check: create an invitation with the Member token. | 403. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-NEG-04 — Member cannot change roles

**Priority:** Critical

| # | Action | Expected result |
|---|---|---|
| 1 | As Member, open People. | Roles are static badges; no dropdowns. |
| 2 | Optional API check: PATCH a member role with the Member token. | 403. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-NEG-05 — Member cannot archive or rename the workspace

**Priority:** Critical

| # | Action | Expected result |
|---|---|---|
| 1 | As Member, inspect the sidebar and home. | No Settings entry; the home settings section is not rendered for non-admins (record the exact behavior). |
| 2 | Optional API checks: PATCH workspace / archive. | 403. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-NEG-06 — Member meeting restrictions

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | As a non-manager project member, inspect meetings. | No Edit/Delete; no attendee add control. |
| 2 | Optional API checks: PATCH/DELETE meeting, POST attendee. | 403 (self-removal via DELETE attendee/{self} still returns 204). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-NEG-07 — Anonymous access exposes no real data

**Priority:** Critical · **Preconditions:** signed out

| # | Action | Expected result |
|---|---|---|
| 1 | Open the app root. | Landing page only; no workspace name, projects, people, or activity. |
| 2 | Open `?invite=<valid token>` signed out. | Only the invitation banner; no workspace details leak (no name/members). |
| 3 | Check DevTools → Network. | No authenticated API calls are made while signed out. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

## 14. Cross-cutting regression (`TC-REG`)

### TC-REG-01 — Prototype and real data never mix

**Priority:** Critical

| # | Action | Expected result |
|---|---|---|
| 1 | Sign in as Owner and note the real workspace data (name, projects, people count). | — |
| 2 | Sign out, enter the demo, and inspect its data. | Prototype sample data only ("Product & Engineering", Ava); none of the real records. |
| 3 | Create a demo task, exit to the landing, sign in. | Real workspace unchanged; the demo task is absent. |
| 4 | Check Local Storage. | `asquii.prototype.v8` holds demo data; real data is not written into it. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-REG-02 — Dark theme across all screens

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Toggle to dark on the landing page. | Landing is dark and readable. |
| 2 | Sign in. | Real home is dark; no light flash. |
| 3 | Visit People, Settings, project detail, and the demo. | All use the dark tokens; cards, badges, inputs, and modals are readable. |
| 4 | Toggle back to light and reload. | The choice persists. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-REG-03 — Tailwind utilities actually render

**Priority:** Low

| # | Action | Expected result |
|---|---|---|
| 1 | Inspect the landing hero at desktop width. | The decorative blurred orbs are visible (brand tint), not invisible placeholders. |
| 2 | Inspect the headline. | Large responsive size applied; `text-balance` wrapping looks intentional. |
| 3 | Check the build. | `npm run build` (optional) succeeds; no missing-class warnings that break layout. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-REG-04 — Sidebar routes after the People/Settings fix

**Priority:** Critical

| # | Action | Expected result |
|---|---|---|
| 1 | Signed in, click **Overview → People → Workspace settings → Overview**. | Each view renders its own content; the highlight follows the click. |
| 2 | Confirm People is not the home. | People shows members + invitations only. |
| 3 | Confirm Settings is not the home. | Settings shows rename/archive only. |
| 4 | Click **Projects** and open a project. | Project detail renders (not the home). |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-REG-05 — Sign-out clears real workspace state

**Priority:** High

| # | Action | Expected result |
|---|---|---|
| 1 | Sign in, open People, then sign out. | Landing page. |
| 2 | Sign in as a different account (or sign out and back in). | No stale People/Settings view; the app opens on the correct home for the account. |
| 3 | Confirm no cross-account data. | The second account never sees the first account's workspace data. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-REG-06 — Reload restores the selected workspace

**Priority:** Medium · **Preconditions:** two workspaces

| # | Action | Expected result |
|---|---|---|
| 1 | Switch to the second workspace. | Its home loads. |
| 2 | Reload. | The same workspace is selected (selection persisted in `asquii.active-workspace`). |
| 3 | Switch back to the first workspace. | Loads correctly; no mixed projects/people. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-REG-07 — Invite query survives the demo round-trip

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Signed out, open `http://localhost:5173/?invite=<token>`. | Landing with the invitation banner. |
| 2 | Click **Explore the demo mock**, then **Back to landing**. | The URL still contains `?invite=<token>`; the banner is still shown. |
| 3 | Browser Back then Forward. | The query string survives both transitions. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

### TC-REG-08 — Session-expired quirk recovery

**Priority:** Medium

| # | Action | Expected result |
|---|---|---|
| 1 | Sign in and leave the tab idle until the access token expires (or simulate by clearing the session token while keeping the app open). | A "Session expired…" message may appear once. |
| 2 | Reload and sign in again. | Sign-in succeeds; the app works normally. |
| 3 | Check the console. | No uncaught exceptions or repeated retry loops. |

**Result:** [ ] Pass  [ ] Fail  [ ] Blocked
**Notes:**

## 15. Sign-off

| Field | Value |
|---|---|
| Tester | |
| Date | |
| Build / commit | |
| Browser + version | |
| Environment (backend URL, DB) | |
| Total cases run | |
| Passed / Failed / Blocked | |
| Release recommendation | [ ] Ready  [ ] Ready with known issues  [ ] Not ready |

### 15.1 Defect report template

```
ID:            DEF-<n>
Case:          TC-XXX-NN
Severity:      Critical / High / Medium / Low
Account:       Owner / Admin / Member / Non-member
URL / view:
Steps:
  1.
  2.
Expected:
Actual:
Evidence:      console error / network status / screenshot path
Notes:
```

### 15.2 Known limitations (not defects)

1. No dedicated `/login` or `/register` routes — authentication is the `AuthPanel` modal.
2. No forgot-password flow.
3. No per-person notification inbox — the workspace activity feed is the notification surface.
4. Sidebar navigation is state-based; only landing ↔ demo participates in browser history.
5. Invitation email delivery is not wired — the token must be copied and shared manually.
6. Meeting agenda is plain text (line breaks preserved, no rich formatting).
7. Workspace archive has no restore endpoint in the app.
8. Project membership add/remove is not implemented in the UI yet (Members tab is read-only).
9. Resource binary upload is not supported; links and metadata only.

### 15.3 Suggested execution order

1. Environment (`TC-ENV`).
2. Landing (`TC-LAND`) and demo (`TC-DEMO`).
3. Auth (`TC-AUTH`).
4. Home (`TC-HOME`).
5. People (`TC-PEOPLE`) and Settings (`TC-SET`).
6. Project detail (`TC-PROJ`) and Meetings (`TC-MEET`).
7. Negatives (`TC-NEG`).
8. Cross-cutting (`TC-REG`).
9. Fill §15 and file defects with the template in §15.1.

