# Sprint 9.1 — Supabase Target and Database Assessment

## Scope and evidence

This is a repository-side assessment. No database connection or SQL was used for this sprint. Live database facts below are carried forward from the completed Sprint 9 read-only inspection supplied in the task context; they were not rechecked. Repository facts were established by inspecting the current configuration, ORM metadata, Alembic environment/revisions, and SQL drafts.

The operator has now stated that the intended target is the existing Supabase `main` branch, which they identify as production, and wants to work on that target. This is a user-provided target designation, not independently verified project metadata. No production database action is authorized by this assessment.

The assessment does not authorize applying migrations, changing roles/grants, enabling RLS, or deploying the draft policies. Keep the branch `backend/foundations`; no application or frontend code is changed by this assessment.

## Verified live facts from Sprint 9 inspection

| Finding | Status | Evidence boundary |
|---|---|---|
| PostgreSQL 17.11; database `postgres`; connected as `postgres` | VERIFIED | Prior read-only query, transaction reported `transaction_read_only=on`. |
| Connected role has `rolbypassrls=true`, is not a superuser, and has broad memberships including `anon`, `authenticated`, `authenticator`, and `service_role` | VERIFIED | Prior `pg_roles` and role-membership catalog query. This was the inspection login, not proof of the current production runtime role. |
| `public.alembic_version` is absent | VERIFIED | Prior `to_regclass` catalog query. |
| All 15 expected Asquii tables and all public application relations are absent | VERIFIED | Prior read-only catalog query. |
| Expected constraints, indexes, triggers, RLS policies, and activity-writer function are absent | VERIFIED | Prior read-only catalog query against the expected objects. |
| `auth.uid()` exists and is executable by the inspection role | VERIFIED | Prior catalog/privilege query; not an identity-propagation test. |
| Fresh inspection connection had no request claim GUCs set | VERIFIED | Prior query checked only presence of `request.jwt.claim.sub` and `request.jwt.claims`; it did not set them. |
| Application identity propagation and pool isolation | NOT VERIFIED | No write-based GUC or pool reuse experiment was authorized. |

These facts indicate the inspected database has not received the local Asquii migrations in `public`. The operator identifies the intended target as Supabase `main`/production and says its clean state is intentional. The inspection did not independently verify that project/branch mapping. An empty production database is still a production target; emptiness does not lower the change-control requirements.

## Intended schema

`public` is the intended schema for the 15 Asquii application tables and lifecycle functions/triggers. This is supported by:

- Revision 0003 explicitly creates and drops lifecycle functions and triggers in `public`, and its downgrade explicitly drops all 15 tables from `public`.
- The RLS and activity-writer drafts refer to `public.<table>` and place helpers in a non-API `private` schema.
- SQLAlchemy models set `__tablename__` without `__table_args__ = {"schema": ...}`; except for the external identity reference, their metadata has no explicit schema and therefore resolves through the PostgreSQL default schema/search path.
- `backend/app/models/external.py` explicitly maps the externally managed `auth.users` relation to schema `auth` and marks it external so Alembic autogeneration excludes it.

### Schema targeting gap

Revision 0002 uses unqualified `CREATE TABLE`, `CREATE INDEX`, and some other object names in raw SQL. The Alembic environment does not set `version_table_schema`, and the ORM metadata does not declare a common application schema. Consequently, those objects rely on the connection's effective `search_path`/default schema. The code and follow-up revisions strongly imply `public`, but revision 0002 does not pin every object to `public`. An unexpected role/database search path could place unqualified objects elsewhere while revision 0003 and its downgrade continue to target `public` explicitly.

**Recommendation:** before a first deployment, make the migration target explicit in a reviewed follow-up design: either qualify the DDL and Alembic version table with `public`, or enforce and validate a controlled migration `search_path` (including its behavior through the selected Supabase connection mode). The migration script should fail before creating objects if it is not operating in the expected database/schema. Do not silently edit already-applied history; the live inspection suggests no local app revision is recorded, but this should be rechecked on the confirmed target before choosing whether a revision correction is safe.

## Migration assumptions and dependencies

Local Alembic history is:

```text
0001_empty_baseline
└── 0002_mvp_schema
    └── 0003_lifecycle_hardening  (local head)
```

Revision 0002 creates the approved 15-table relational schema and lifecycle/activity functions/triggers. It references `auth.users(id)` for profiles and calls PostgreSQL UUID/default functionality. Supabase Auth owns the `auth` schema and `auth.users`; Asquii migrations must not create, alter, or drop Supabase Auth objects. Revision 0003 assumes 0002's tables exist in `public`, explicitly replaces lifecycle triggers/functions there, and its downgrade drops those public application objects.

Migration state recorded in the prior inspection is absent (`public.alembic_version` not found). The inspection did not prove there are no objects in other schemas, nor that this database is the intended staging target. A fresh target baseline and target identity must be approved before applying any migration.

## SQLAlchemy access and transaction identity

The current engine is synchronous SQLAlchemy/Psycopg with bounded pool settings (defaults: pool size 3, overflow 2, timeout 5 seconds), connection timeout, statement timeout, `pool_pre_ping`, and Psycopg prepared-statement caching disabled. `get_db` receives a `CurrentUser` from the JWT dependency and stores a small claim mapping (`sub`, fixed `role=authenticated`, configured audience) in `Session.info`. A SQLAlchemy `Session.after_begin` event writes `request.jwt.claims` and `request.jwt.claim.sub` using transaction-local `set_config(..., true)`.

The hook does **not** issue `SET LOCAL ROLE authenticated`. It does not change the database login or role. The previous live inspection connected with `current_user=postgres` and `BYPASSRLS`; applying the GUC hook while continuing to connect as such a role would not make RLS an authorization boundary. PostgreSQL roles with `BYPASSRLS` skip policies. The existing unit tests verify the hook's Python/SQL construction only, not `auth.uid()`, grants, role state, actual rollback/reset behavior, or reuse of a physical pooled connection.

Transaction-local settings are necessary for safe reuse across transaction-pooled connections, but are not by themselves proof of end-user identity at the database boundary. A shared backend database login capable of setting custom JWT GUCs can set arbitrary subject values if its credentials or execution path are compromised. Under this design, verified JWT-to-GUC mapping is a trusted backend assertion; RLS can be defense in depth against query mistakes, not a defense against a compromised backend credential/process. A Supabase Data API request carrying the user's JWT delegates claim verification and role selection to Supabase/PostgREST, but requires changing the current SQLAlchemy data path.

## Existing RLS and activity-writer drafts

The SQL files in `docs/supabase/` are not migrations and have not been applied. Review findings:

### `05_rls_policies.sql`

- Creates membership/policy helper functions in `private`, schema-qualified with empty `search_path`, which is a useful hardening measure.
- All policy helpers are `SECURITY DEFINER` with `row_security=off`. Their effective privileges and RLS bypass depend on function ownership. An owner with `BYPASSRLS` (including the observed `postgres`-like inspection role) can read around RLS; a less privileged owner may fail when `row_security=off`. This must not be guessed.
- Every `CREATE POLICY` omits `TO`; PostgreSQL defaults this to `PUBLIC`. This is broader than necessary. Policies should be explicitly role-scoped after the runtime role-assumption design is proven. RLS policies and SQL grants are separate controls: policy presence does not grant table privileges.
- The script grants schema usage and execute on all helper functions to both `anon` and `authenticated`. `workspace_has_any_member(uuid)` answers whether any membership row exists for an arbitrary workspace UUID and does not require an authenticated actor; granting it to `anon` exposes an avoidable existence oracle. Helper execution should be minimized and reviewed individually.
- The script changes invitations column privileges, but does not provide a complete least-privilege table/sequence/function grant inventory for all 15 tables.
- Known API mismatches are already listed in `docs/supabase/README.md`: invitation token lookup, workspace self-leave, initial meeting attendees, role-sensitive column updates, and activity writes. These block rollout.
- Enabling RLS alone would deny normal access for roles without applicable policies; enabling policies without reviewing grants can still leave broad table access. Supabase guidance requires both grants and RLS for exposed tables.

### `06_activity_writer.sql`

- Revokes execution from `PUBLIC`, `anon`, and `authenticated`, and grants execution to no role; that is safer than exposing a partially reviewed writer.
- It is `SECURITY DEFINER` with `row_security=off`; owner selection and privileges are unresolved.
- Its checks establish a signed-in actor and workspace membership, and ensure a supplied project belongs to the workspace. They do not enforce all API-level action permissions or prove the `entity_id` belongs to the workspace/project. Workspace archival is not checked. It must not be granted or wired into runtime before a complete threat model and negative test suite are reviewed.
- Current service event helpers insert through the ordinary SQLAlchemy session. The candidate function does not resolve the activity-writer boundary or ADR-010.

Neither draft should be executed as part of this assessment.

## References

- [Supabase Postgres roles](https://supabase.com/docs/guides/database/postgres/roles) — describes `postgres`, `authenticator`, `authenticated`, `anon`, and elevated `service_role` responsibilities.
- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) — grants and policies both matter; `BYPASSRLS` and ownership implications.
- [Supabase database connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres) — connection choice depends on workload/network; confirm mode from the target project's settings.
- [PostgreSQL 17 row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html), [role membership](https://www.postgresql.org/docs/17/role-membership.html), and [`SET ROLE`](https://www.postgresql.org/docs/17/sql-set-role.html) — RLS bypass, policy role matching, membership `SET` semantics.

## Conclusion

`public` is the intended Asquii schema, while revision 0002 is not fully schema-qualified. The prior live inspection found the inspected database empty of the expected application schema and using a `BYPASSRLS` login with broad memberships. No claim is made that current RLS, the identity hook, or tenant isolation works. Use [the database access security plan](25-database-access-security-plan.md) as the controlled path forward.
