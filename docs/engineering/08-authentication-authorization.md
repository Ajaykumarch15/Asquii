# 08 — Finalized authentication and authorization

## Identity and request flow

1. React uses the Supabase Auth SDK for registration, login, logout, verification, password recovery, and refresh. Supabase Auth owns credentials and identity; no app password table.
2. React sends its Supabase access JWT to FastAPI as `Authorization: Bearer <token>`.
3. FastAPI validates signature (JWKS/key rotation), issuer, audience, expiry/not-before and subject; invalid tokens fail closed with 401.
4. FastAPI resolves the actual profile and active workspace/project membership from PostgreSQL inside request authorization. No user ID or role is trusted from request bodies or UI claims.
5. Service code authorizes action and starts a SQLAlchemy transaction. For direct SQL connections using RLS, transaction-local identity settings are established before any tenant query (details below).
6. The intended deployment uses a least-privilege application DB login without `BYPASSRLS`; this role configuration and RLS boundary remain unverified against Supabase.

### Sprint 3 implementation status

FastAPI now verifies bearer tokens using PyJWT. The default signing method is asymmetric JWKS verification from the configured Supabase project host. Only RS256 and ES256 are allowed; the JWT header selects an algorithm only from this server-side allowlist, and its `kid` must match a signing key. Issuer defaults to `<SUPABASE_URL>/auth/v1`, audience defaults to `authenticated`, `exp`, `sub`, `iss`, and `aud` are required, and `nbf` is verified when present. The verified subject must parse as a UUID. Only the verified email claim is exposed as optional profile contact data; generic `role` and user metadata are ignored for policy decisions.

JWKS is cached per process for a configured 30–3600 second TTL (300 seconds by default). Refreshes for unknown key IDs are rate-limited to at most one per 30 seconds; unknown keys fail closed. A fresh cache can serve while refresh is unavailable, but missing/expired cache plus an unavailable endpoint returns a sanitized 503. Legacy HS256 is an explicit opt-in setting and uses HS256 only with a separately configured secret. See [17](17-sprint-3-implementation-report.md) for test coverage and remaining staging verification.

`GET /api/v1/auth/me` is authenticated. It returns the verified user ID/email and persisted safe profile fields. A missing profile is inserted with the verified subject using PostgreSQL `ON CONFLICT DO NOTHING`; existing user-edited values are not overwritten. The SQLAlchemy request session is configured with transaction-local identity context as described below; actual `auth.uid()` behavior remains unverified.

### Sprint 4 workspace authorization behavior

Workspace APIs obtain the actor only from `get_current_user` and load active membership rows inside an explicit request transaction. Current Owner/Admin membership gates workspace administration and invitations. Workspace archival is Owner-only; role changes and ownership transfer are Owner-only. Active workspace members can read workspace/member details. Project collaboration rows are not silently deleted during workspace-member removal; removal returns 409 while any project roster entry remains, pending a project-roster lifecycle operation. Ownership transfer locks the workspace, demotes the current Owner before promoting the active successor to respect the immediate partial unique index, and commits both changes and activity together.

Invitation acceptance uses the verified token email, a SHA-256 token lookup, workspace and invitation row locks, and a single transaction for membership, accepted state, profile provisioning, and activity. Only the creation response returns the plaintext random token; later reads expose neither it nor the stored hash. Invitation expiry is seven days. Email delivery is out of scope.

Supabase client handles refresh. A failed/expired token gets one SDK refresh/retry according to client behavior, then auth UI handles sign-in. Do not place service-role secrets in React or use service-role credentials for ordinary request handling.

## MVP role matrix

| Capability | Owner | Admin | Member, not on project | Project Manager | Project Member |
|---|---:|---:|---:|---:|---:|
| Read workspace and all active workspace projects | yes | yes | yes | yes | yes |
| Change workspace settings | yes | yes | no | no | no |
| Archive workspace (Sprint 4 endpoint) | yes | no | no | no | no |
| Manage workspace members/invitations | yes | yes | no | no | no |
| Create projects | yes | yes | no | no | no |
| Read active project and child content | yes | yes | yes, read-only | yes | yes |
| Change project settings/archive | yes | yes | no | yes | no |
| Manage project membership | yes | yes | no | yes | no |
| Manage permitted project content (tasks, meetings, resources, comments) | yes | yes | no | yes | yes |
| Transfer workspace ownership | yes, only current owner | no | no | no | no |

Exactly one active Owner per workspace; Owner is a workspace_members row, not a separate owner_id. Owner/Admin are the only workspace roles that manage membership/invitations and create projects. Workspace Members read all active projects; project membership grants collaboration/write access. Private project visibility, Guest, Viewer, and custom roles are out of MVP. Project roles are exactly Project Manager and Project Member. Admin override does not require duplicate project membership.

Ownership transfer is one transaction: lock the workspace, validate an active successor, promote successor to Owner, demote former Owner to Admin, and commit with exactly one active owner. Removing/demoting the active owner without transfer is rejected. Workspace archive is restricted to Owner/Admin and follows the reversible lifecycle in ADR-012: pending invitations are revoked, memberships and project archive timestamps are retained, and access is denied until restore.

## FastAPI authorization versus RLS

FastAPI authorization is the product policy layer: it determines action-specific permissions, field rules, and business invariants; return 403 or concealed 404 consistently. RLS is defense in depth, ensuring SQL from the application login cannot read/write outside the caller's scope. Passing RLS is not a substitute for service authorization.

### Direct SQLAlchemy connection strategy

After validating the JWT, begin an explicit transaction and set identity context with transaction-local settings before tenant queries, conceptually `SET LOCAL ROLE authenticated` and `set_config('request.jwt.claim.sub', <validated-sub>, true)` plus the trusted role/claims settings expected by the deployed Supabase `auth.uid()` implementation. Values must be bound parameters; role switching must be explicitly granted and verified. Never use session-level SET. Ensure rollback/commit ends context before a pooled connection is returned; transaction pooling must not reuse identity outside that transaction. Confirm actual Supabase grants, role membership, pooler mode, `auth.uid()` behavior, and application role attributes in staging. App login must not have `BYPASSRLS`; do not assume Supabase default grants match this deployment.

If this identity propagation cannot be proven reliable with SQLAlchemy and the selected pooler, use Supabase Data API calls with the validated end-user JWT for RLS-scoped operations, or isolate a separate tightly controlled database role strategy. Do not silently fall back to a service-role key.

### Sprint 9 implementation and verification status

`get_db` depends on the verified current-user dependency and stores only its UUID subject plus fixed `role=authenticated` and configured audience in `Session.info`. A SQLAlchemy `after_begin` listener sets both `request.jwt.claims` and `request.jwt.claim.sub` using bound parameters with `set_config(..., true)`, so values are scoped to each PostgreSQL transaction and reapplied after nested transaction begins. No session-level `SET` or database role assumption is performed. The code and unit tests are **implemented**, but no Supabase URL/database credentials were configured; `auth.uid()`, rollback/reuse behavior, and transaction-pooler behavior are **not verified**. RLS remains disabled by the application migrations until the operator reviews and verifies policies and grants.

Scripts in [the Supabase runbook](../supabase/README.md) include a rollback-only SQL probe. It does not substitute for using the production connection pool with alternating authenticated users after commit and rollback.

### Policy intent

- `workspaces`: SELECT active workspace member; update settings Owner/Admin; Sprint 4 archive endpoint Owner-only; INSERT through atomic creation operation.
- `workspace_members`: SELECT active workspace member; INSERT/UPDATE/DELETE Owner/Admin only, with transaction-level exactly-one-owner protections. Owner transfer is a narrow authorized operation.
- `workspace_invitations`: Owner/Admin read/create/revoke; accept only authenticated verified user whose normalized email matches invitation; token consumed once.
- `projects`: SELECT all active projects for active workspace members. INSERT Owner/Admin. UPDATE/archive Owner/Admin or project manager. No private-project policy.
- `project_members`: SELECT workspace members. INSERT/UPDATE/DELETE Owner/Admin or project manager; target user must be workspace member (composite FK).
- `milestones`, `tasks`, `task_subtasks`, `task_comments`, `meetings`, `meeting_attendees`, `resources`: SELECT active workspace members for active project. Writes Owner/Admin or active project member; project settings/membership remain project-manager/admin only. Assignee, meeting attendee, resource owner must be project member (composite FK).
- `user_resource_preferences`: owner can select/upsert/delete only own row and only while active workspace access to resource remains.
- `activity_logs`: active workspace members read; no client write/update/delete. Trusted backend operations write append-only events.
- Conditional notifications/preferences: recipient may read/update own records only while active workspace member; recipient and workspace consistency constrained.


| Table family | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| workspaces | Active workspace members | Atomic authenticated create with creator Owner | Owner/Admin | No hard delete; Owner/Admin archive via update |
| workspace_members | Active workspace members | Owner/Admin; initial Owner only through workspace creation transaction | Owner/Admin; ownership transfer transaction only for Owner transition | Owner/Admin, but reject removal of current Owner before transfer |
| workspace_invitations | Owner/Admin | Owner/Admin | Owner/Admin revoke/status transitions; invite acceptance consumes once under verified identity | Owner/Admin revoke; retain/revoke record per policy |
| projects | Any active workspace member, active project only | Owner/Admin | Owner/Admin or Project Manager | No hard delete; Owner/Admin/Project Manager archive |
| project_members | Any active workspace member | Owner/Admin or Project Manager; target must be workspace member | Owner/Admin or Project Manager | Owner/Admin or Project Manager; preserve manager invariant |
| milestones, tasks, subtasks, comments, meetings, attendees, resources | Any active workspace member for active project | Owner/Admin or project member; related people must be project members | Owner/Admin or project member | Owner/Admin or project member subject to archive/retention; no destructive hard delete unless policy permits |
| user_resource_preferences | Row owner while workspace access remains active | Row owner, own resource preference only | Row owner | Row owner |
| activity_logs | Active workspace member | No client INSERT; trusted backend operation only | Never | Never |
| conditional notification preferences/notifications | Own row, active workspace membership | Trusted backend/service path; preference owner may upsert only own preference | Own read state/preferences only | No client delete; backend retention only |

The table above describes API/client effects; the database application role must not have grants that undermine the RLS rules. Trusted activity/notification insertion may use a narrow database function or backend-controlled insert permission scoped to validated transactions, never a client policy.

Use safe, narrowly scoped helper functions to avoid recursive membership-table RLS; lock `search_path` and revoke public execute for any `SECURITY DEFINER` helper. Deny by default.

## Staging verification

Before production, verify actual grants/role membership and RLS with a staging Supabase project and the production connection/pooler mode. Test anonymous, expired/bad JWT, two users in different workspaces, same-workspace non-project member (read yes/write no), project member, manager, admin override, ownership transfer race, cross-workspace FK attempts, invalid assignee/attendee/resource owner, and pooled connection reuse after commit and rollback. Assert no identity survives into the next request. Inspect database role flags for `BYPASSRLS`; verify direct SQL policies and, if needed, Data API alternative. Never test against production in this sprint.


## RLS identity validation gate (not yet verified)

This repository has no configured Supabase staging connection, so these checks are design requirements, not completed verification. Before selecting direct SQLAlchemy for tenant queries, prove in staging that (1) the application role lacks `BYPASSRLS`; (2) it may safely assume the intended `authenticated` database role; (3) validated JWT claim settings are transaction-local; (4) `auth.uid()` returns the validated JWT subject; (5) pooled connections do not carry identity across users after commit or rollback; and (6) the actual Supabase pooler mode supports the strategy. Check grants/role membership from PostgreSQL, not assumptions. Run alternating-user same-connection tests through the actual pooler. If any condition fails or remains uncertain, use Supabase Data API with the user's JWT for RLS-scoped operations. Service-role credentials are not an alternative.

## Trusted activity-write gate

No client INSERT policy and no ordinary application-role INSERT/UPDATE/DELETE grants on `activity_logs`. The backend event is part of the same business transaction. Because a shared DB credential cannot tell trusted code from arbitrary code holding that credential, writes must go through a narrowly controlled database function or isolated privileged writer path; constrain function parameters, owner, `search_path`, execute grants and RLS effect. Retention period, legal hold and purge authorization remain UNKNOWN; do not add automatic deletion before the policy is approved.
