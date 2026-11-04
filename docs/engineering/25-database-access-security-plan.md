# Sprint 9.1 — Database Access Security Plan

## Status and guardrails

This is a design and deployment plan only. It contains no executed SQL and does not authorize role creation, grants, migrations, RLS activation, or production deployment. No database connection was made for Sprint 9.1. The operator identifies the intended target as the existing Supabase `main` branch/production project and says the empty database is intentional. This designation is user-provided and was not independently verified during Sprint 9.1.

Do not use the shared `postgres`/administrator login as the FastAPI runtime credential. Do not use the Supabase secret/service-role key as an RLS identity substitute. Do not treat `request.jwt.claim.*` values set by the backend as proof that PostgreSQL independently authenticated the end user.

## Repository preparation status

On `backend/foundations`, the local Alembic environment now pins its version table to `public`, sets transaction-local `search_path` to `public, pg_catalog` for online migrations, and fails closed if the effective schema is not `public`. Revisions 0002 and 0003 also set this path at upgrade/downgrade entry so offline SQL has the same DDL target. These changes have not been applied to any database.

The RLS SQL remains a review draft. It now scopes policies and helper execution to `authenticated`, revokes app-table privileges from `PUBLIC`, `anon`, `authenticated`, and `service_role` before regranting a per-table subset, narrows workspace and membership update columns, removes the unscoped workspace-member-existence helper, and requires the reviewed `asquii_owner` role when creating definer helpers. Initial workspace/Owner creation remains denied pending a restricted atomic operation. No policy SQL has been run, and no PostgreSQL policy behavior is verified.

The latest read-only probe-table check found `asquii_db_probe` with RLS enabled and FORCE RLS disabled, no policies, no DML grants to `anon`, `authenticated`, or `service_role`, and DML privileges for `postgres`. The previous inspection found no Asquii tables or `public.alembic_version`; recheck immediately before deployment. Database-password and Supabase secret-key rotation is still a prerequisite before the next deployment connection because credentials were previously shared in chat; no credential values were printed or changed during repository preparation.

## Recommended architecture

### Separate migration ownership from runtime access

Use three distinct principals, subject to Supabase support and operator review:

| Principal | Purpose | Required boundary |
|---|---|---|
| `postgres` or other controlled Supabase administrator | Human-operated bootstrap/recovery only | Secrets held by operators, MFA/secret manager, audited use; never in FastAPI configuration. The observed login has `BYPASSRLS`, so it is unsuitable for request traffic. |
| Non-login Asquii schema owner, e.g. `asquii_owner` | Owns Asquii tables, indexes, triggers and reviewed policy helpers | No direct login. Owns only application objects. Its default RLS-owner bypass is not used as a runtime path. |
| Deployment/migration principal, e.g. `asquii_migrator` | Runs reviewed Alembic revisions during a release window | Separate secret and pipeline/operator access. Can assume the owner only for migration deployment if the managed platform grants and approved membership model support it. No app-request credentials. |
| Runtime login, e.g. `asquii_runtime` | FastAPI SQLAlchemy requests | `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`, `NOCREATEROLE`, `NOCREATEDB`; not an owner and not a member of `postgres`, `service_role`, or `authenticator`. No broad schema/object creation privileges. |

The role names above are proposals, not claims that these roles exist or that the inspected Supabase project permits their creation/membership. Verify Supabase-managed role restrictions and version-specific membership options first. Never alter managed roles such as `authenticated`, `anon`, `authenticator`, or `service_role` to make the proposal fit.

### End-user role context for direct SQLAlchemy

If direct SQLAlchemy with RLS is retained, each authenticated request transaction must establish both:

1. The verified JWT subject/claims in transaction-local GUCs, and
2. An effective PostgreSQL role to which the reviewed application policies and grants apply, normally `authenticated`.

The current `after_begin` hook does only the first item. A possible design is a runtime login that has a narrowly scoped `SET` membership in `authenticated`, with the hook establishing claims and issuing `SET LOCAL ROLE authenticated` before any tenant query. This design is **unverified** and requires confirmation that: the selected Supabase role supports this membership path; the role cannot assume any elevated role; SQLAlchemy executes the setup before every query/transaction; errors roll back; and pooled/transaction-pooled connections do not retain identity or role after commit/rollback. Runtime should not inherit unrelated privileges from `authenticated` outside this transaction context. Avoid broad `INHERIT` paths; use the PostgreSQL membership `SET` option only if the platform supports and the operator approves the exact membership.

Even when role and claims are transaction-local, the shared runtime database credential can set a different custom subject if compromised. This trust model is defense in depth against application query omissions, not protection against a compromised FastAPI process or leaked DB credential. If that trust boundary is unacceptable, use the Supabase Data API with each end-user JWT (or another supported identity-aware DB gateway) instead of pretending manually set claims are independently authenticated. That fallback would require a deliberate adaptation of the existing synchronous ORM/service layer; it is not implemented here.

## Supabase roles and grants

### Required role properties

- Runtime login: no superuser, no `BYPASSRLS`, not table owner, no DDL, no role creation, no database creation, no service-role/authenticator membership, no ability to grant its own elevated membership.
- Effective request role: role policies explicitly target this role; verify its actual `rolsuper`, `rolbypassrls`, memberships, and grants before use.
- Migration owner/principal: can create/alter/drop only the Asquii schema objects needed by Alembic, and can reference (not own or modify) `auth.users(id)` for the existing profile foreign key. It must never be configured as the normal API login.
- `anon`: no Asquii table access is needed for the FastAPI-only API design; revoke/prevent access if Supabase defaults grant it. If public Data API use is later intentionally added, define a separate reviewed policy and grant per table.
- `authenticated`: receives only the table/sequence/function privileges required by current endpoints; row policies further constrain rows. It must not be granted `BYPASSRLS` or table ownership.
- `service_role`: do not grant to the runtime login and do not use its API key in request processing. It bypasses RLS by design.
- `authenticator`: reserve for Supabase/PostgREST's managed API role switching; do not make it the FastAPI's direct database login.

### Grant matrix to design and verify

| Object class | Migration/owner | Runtime role before assuming `authenticated` | Effective `authenticated` role |
|---|---|---|---|
| Database connect | Deployment path only as needed | `CONNECT` only | Not applicable to current role after connection. |
| `public` schema | Owner/deployer may create approved objects | `USAGE` only if needed to resolve objects; no `CREATE` | `USAGE`; no `CREATE`. |
| Asquii tables | Owner owns them | No direct data grants if all request SQL runs after `SET LOCAL ROLE`; otherwise only deliberate minimum | Explicit `SELECT`/`INSERT`/`UPDATE`/`DELETE` per endpoint and table, then matching RLS policies. Deny `TRUNCATE`, `REFERENCES`, and `TRIGGER` unless separately justified. |
| Sequences | Owner owns them | No direct use unless justified | Only `USAGE`/`SELECT` needed by identity/default sequence behavior; MVP UUID keys mostly use UUID defaults, verify model/migration inventory. |
| `auth.users` | Supabase Auth owns it | None | None for normal app requests; the profile FK only requires migration-time reference privilege. |
| `private` helpers | Owner/deployer | No access | No API exposure; grant only required `USAGE`/`EXECUTE` to the effective request role, ideally not every helper and never to `anon` without a use case. |
| Activity writer | Owner/deployer | No direct activity insert if using a function boundary | No grant until design proves the actor, scope, action, entity binding, and RLS behavior; then grant execute only to the chosen isolated path. |

Supabase projects may have default privileges that grant `anon`, `authenticated`, or `service_role` access to new public tables. Inspect and explicitly reconcile both current and default privileges; RLS does not revoke SQL privileges. Do not assume policies alone make a table inaccessible.

## Migration privileges versus runtime privileges

Migrations create/alter tables, indexes, constraints, triggers, functions, policies, grants, and `alembic_version`; they require DDL and ownership-level privileges for the Asquii objects. The migration principal also needs the limited right to reference `auth.users` for the profile FK. This is a controlled deployment operation.

Runtime requests should perform only endpoint-required DML and function execution under an effective role with RLS. They must not own tables, create schema objects, change grants, create roles, or use RLS bypass. Table ownership normally bypasses RLS; `BYPASSRLS` and superuser always do. Merging these principal responsibilities would undermine the intended separation.

Alembic's `alembic_version` table and application DDL currently rely on default schema/search path. Before first deployment, explicitly settle its schema as `public` and validate `search_path` before running. The migration creates the Asquii schema but must not alter Supabase-managed `auth` objects.

## RLS and activity draft review gates

Do not execute the current scripts as-is.

1. **RLS role scope:** update the reviewed policy design so each policy has an explicit `TO authenticated` (or other intentionally selected role). Current policies omit `TO`, which means `PUBLIC` by PostgreSQL default.
2. **Privileges:** write a complete, minimal grant/revoke plan for tables, sequences, schemas, functions, and default privileges. Revoke unwanted `anon`/`PUBLIC` access. Confirm both grants and policies for each endpoint operation.
3. **Identity bootstrap:** resolve effective role assumption and transaction-local GUC setup together; the current hook omits `SET LOCAL ROLE` and has only unit coverage.
4. **Definer helpers:** inventory every `SECURITY DEFINER` function; prefer invoker functions when possible. Where definer is necessary, use a non-login narrowly privileged owner, fixed `search_path`, explicit object qualification, least `EXECUTE`, verified ownership and recursion behavior. `row_security=off` is not a substitute for a clear role model.
5. **Helper exposure:** remove unnecessary `anon` access. The repository draft now removes `workspace_has_any_member`, which exposed a boolean membership-existence oracle for arbitrary workspace IDs. Keep helper execution limited to `authenticated` and verify function ownership/behavior on PostgreSQL.
6. **API compatibility:** resolve invitation token handling, safe self-leave, meeting attendee creation, owner-only field updates, and activity insert path. Column grants or narrowly scoped functions may be required; do not broaden policies to make existing flows pass.
7. **Activity writer:** do not grant the candidate function yet. First bind every action and entity to authorized scope, enforce the actual action permission, check active workspace/project state, select a tightly controlled function owner, and prove the API calls it within the same transaction without allowing caller-supplied actor IDs.
8. **Append-only:** the trigger blocks UPDATE/DELETE but does not block INSERT, TRUNCATE, owner/admin bypass, or all privileged maintenance actions. Confirm role grants and trigger behavior for the selected runtime/migration roles.

PostgreSQL evaluates object privileges before row policies; both layers must be present and tests must cover the composed result. Avoid granting all table privileges as a shortcut. Include column-level restrictions for invitation `token_hash` and role/archive fields where needed.

## Controlled deployment sequence

1. **Target confirmation:** the operator identifies the target as Supabase `main`/production and says it is intentionally empty. Independently confirm the exact project ref, environment, database, region, and branch in the Dashboard before any connection or deployment; do not infer environment from a URL.
2. **Recovery readiness:** confirm production backup/PITR coverage, restore procedure, recovery owners, and change window. Obtain explicit production change approval before any write action.
3. **Disposable rehearsal:** before production, use an isolated non-production database to rehearse the full migration, role, grants, RLS, identity, and rollback plan. A clean production database is not a substitute for rehearsal.
4. **Role design approval:** review proposed owner, migration, and runtime principals against Supabase-managed role constraints; inspect existing memberships and default privileges in the rehearsal target. Create no production role until approved.
5. **Migration targeting review:** decide whether to qualify revision 0002 through a new corrective revision or, after proving no applied history on the confirmed target, update the unapplied revision with documented justification. Re-run offline SQL and code review. Validate `public` targeting and Alembic marker schema. Do not rewrite any migration after it is applied.
6. **Rehearsal deployment:** apply revisions only to the disposable target through a separately authorized migration operation using direct/session connection and deployment credentials, never the FastAPI runtime credential. Confirm Alembic head and expected objects afterward.
7. **Privilege plan:** validate object ownership, current grants, and default privileges against the approved owner/runtime model. Keep `auth.users` owned by Supabase Auth; provide only migration-time FK reference permission if needed.
8. **RLS compatibility:** resolve every known API mismatch, use explicit policy role targets, review definer ownership and private schema exposure, and test with two end users plus anonymous access. Use `supabase db advisors`/database tests on the disposable target.
9. **Identity and pooling tests:** with a valid JWT, verify that `auth.uid()` equals its verified subject under the effective `authenticated` DB role; verify role/GUC setup for every transaction; alternate identities on the same physical connection across commit and rollback; verify no identity remains after transaction end. Run this only against the approved disposable target.
10. **Activity and lifecycle tests:** verify actor spoof rejection, activity entity/scope checks, append-only privileges, Owner/Manager lifecycle behavior, and concurrent transfer/removal on PostgreSQL. Do not substitute SQLite.
11. **Production release gate:** only after rehearsal passes, obtain separate explicit production approval, confirm restore point and rollback plan, apply the reviewed migration/access changes through the release operator, and verify outcomes. Keep RLS-dependent FastAPI traffic disabled until the runtime identity design is validated.

## Required human approvals

- Confirmation of target identity/environment and authorization to provision roles or deploy migrations.
- Approval of the exact schema targeting/migration-history decision.
- Approval of role memberships and grants, especially any `SET ROLE authenticated` membership.
- Approval to enable RLS and apply the reviewed policies on a disposable/staging database.
- Approval for write-based identity/pool-reuse and PostgreSQL lifecycle tests on a named disposable database.
- Separate explicit approval for any production rollout.

This sprint performed none of these state-changing actions. The user's intent to work with the production target is not approval to connect, migrate, or alter production.

## Validation checklist before production use

- [ ] Correct target verified independently; migrations at reviewed head.
- [ ] All 15 tables, composite foreign keys, checks, indexes, lifecycle triggers, and append-only trigger inspected and tested.
- [ ] All app objects and Alembic marker are explicitly in `public`; no unexpected schema duplicates.
- [ ] Runtime login is not owner, superuser, `BYPASSRLS`, or member of elevated/system roles.
- [ ] Runtime effective identity is `authenticated`; exact transaction-local role/GUC behavior is proven against the actual pooler.
- [ ] Same-connection alternating-user tests pass across commit, rollback, exceptions, and nested transactions.
- [ ] `anon` has no unintended privileges; default privileges for future tables are reviewed.
- [ ] Every exposed table has minimal grants and role-scoped policies; policy behavior tested for each CRUD path and cross-tenant denial.
- [ ] `SECURITY DEFINER` functions have reviewed owner, fixed search path, restricted execution, and negative tests.
- [ ] Invitation, self-leave, meeting-attendee, role update, and activity writer flows match RLS/grants without broad exceptions.
- [ ] Activity actor/scope/action/entity integrity and append-only restrictions are verified on PostgreSQL.
- [ ] Backup/recovery, monitoring, credential storage/rotation, and release rollback have owners.

## Decision summary

Keep the application's current intended schema at `public`, but make migration targeting explicit before the first application migration is deployed. Separate migration ownership from request traffic. The existing inspected `postgres`-like role with `BYPASSRLS` and broad memberships must not be used as the API runtime identity. Direct SQLAlchemy RLS can only be considered after adding and verifying effective `authenticated` role context alongside the existing transaction-local claims; even then, the trusted FastAPI process can forge those claims if compromised. If that trust model is not acceptable, route RLS-dependent work through Supabase Data API with the end-user JWT instead.

No RLS, tenant isolation, or pool identity behavior is claimed to be working.

## References

- [Supabase Postgres roles](https://supabase.com/docs/guides/database/postgres/roles)
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)
- [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html)
- [PostgreSQL 17 role membership](https://www.postgresql.org/docs/17/role-membership.html)
- [PostgreSQL 17 `SET ROLE`](https://www.postgresql.org/docs/17/sql-set-role.html)
