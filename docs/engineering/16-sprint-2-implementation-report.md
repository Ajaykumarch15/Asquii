# Sprint 2 implementation report — database schema and migrations

Date: 2026-11-04  
Branch: `backend/foundations`

## A. Implementation summary

Implemented PostgreSQL-oriented SQLAlchemy 2.x models for the approved MVP schema and Alembic revision `0002_mvp_schema`, following the existing empty baseline. The migration creates application tables only; Supabase Auth remains an external dependency. No API, auth flow, RLS policies, or frontend changes were introduced.

## B. Database schema

| Table | Purpose |
|---|---|
| `profiles` | Display name/job title keyed to external `auth.users.id`; no credential fields. |
| `workspaces` | Tenant root, slug, archive state; deliberately no owner column. |
| `workspace_members` | Workspace role and reversible removal state; Owner is a membership role. |
| `workspace_invitations` | Normalized invite email, token hash, role, expiry, accepted/revoked timestamps. |
| `projects` | Workspace project, progress settings, status and archive state. |
| `project_members` | Project Manager/Project Member roster. |
| `milestones` | Project milestone name and due date. |
| `tasks` | Project task, status, priority, labels, due date, optional project-member assignee and ordering. |
| `task_subtasks` | Ordered task checklist rows. |
| `task_comments` | Task comment and project-member author, with optional soft-delete timestamp. |
| `meetings` | Project meeting instant, duration, type and agenda. |
| `meeting_attendees` | Project-member attendance rows. |
| `resources` | Project resource metadata; no binary storage implementation. |
| `user_resource_preferences` | Per-user starred state; no shared `resources.starred` field. |
| `activity_logs` | Workspace/project event context, nullable actor, entity reference and JSONB metadata. |

`task_assignees` is not a separate table because the approved database design stores a nullable `assignee_user_id` on `tasks`. The approved `task_subtasks` model is used; recursive parent tasks were not added. Meeting end time is represented by `starts_at` plus positive `duration_minutes`, as specified in the approved design; location and meeting-link fields were not invented. Conditional notification tables were not added.

## C. Integrity and indexes

- UUID primary keys use PostgreSQL `gen_random_uuid()` defaults. Mutable rows have timezone-aware `created_at` and `updated_at`; activity rows have `created_at` only.
- Named `CHECK` constraints enforce workspace/project roles and the approved project/task/meeting/resource value sets, progress bounds, positive meeting duration, normalized invitation email, exclusive invitation terminal timestamps, and nonnegative resource size.
- Composite FKs enforce project/workspace pairing, project membership within both its project and workspace membership, and same-project task assignments, comment authors, meeting attendees, and resource owners. Comments also reference a task using its `(id, workspace_id, project_id)` key. Meeting attendees reference the meeting and member using matching tenant/project context.
- A partial unique index allows at most one active workspace Owner. Deferred constraint triggers enforce at least one active Owner for each non-archived workspace at commit. Parent-row locking triggers serialize workspace membership transitions; the deferred check also locks the workspace before validating final state.
- Deferred project triggers require at least one active Project Manager on each non-archived project. Manager membership must join to an active workspace membership. Project membership transitions lock the project row, and the final-state check re-locks it before counting.
- Query indexes cover workspace/member lookups, project status and archive listing, task project/status/position and assignee/due date, milestone due dates, meeting start time, resource listing, invitations, and activity feeds.
- `activity_logs` rejects SQL `UPDATE` and `DELETE` through a database trigger. The migration does not install deployment-specific database grants or restrict `INSERT`; this trigger alone does not establish a trusted-writer boundary or defeat a sufficiently privileged table owner.

Service authorization and future RLS must still verify current active membership. A foreign key proves a membership row exists; it does not by itself grant authorization. In particular, membership removal/role transitions and any dependent assignments/roster rows must be managed together by a later transactional service layer.

## D. Migration

- New revision: `0002_mvp_schema`
- Parent: `0001_empty_baseline` (preserved unchanged)
- `alembic history` reports a linear chain from the baseline to `0002_mvp_schema`; `alembic heads` reports one head.
- Offline `alembic upgrade head --sql` and `alembic downgrade 0002_mvp_schema:base --sql` both generated successfully.
- No database upgrade or downgrade was executed. No disposable PostgreSQL/Supabase staging connection was available. Runtime DDL and trigger validation remain blocked pending that environment.

## E. Tests

The full suite completed with **24 passed, 0 failed** (one existing Starlette/AnyIO deprecation warning). Added static tests verify all 15 model tables register, ORM relationships and PostgreSQL DDL compile, external Supabase Auth is referenced but not modeled as an application table, tenant composite FKs and role/partial-index metadata exist, personal stars and nullable activity context are represented, and the Alembic chain and migration table/trigger declarations are present.

These tests do not replace PostgreSQL integrity/concurrency tests. No PostgreSQL test URL or staging access was available, so cross-tenant rejection, trigger behavior, and concurrent owner/manager transition tests were not executed against a database.

## F. Code quality

`ruff check .` passed with no errors. `ruff format --check .` passed with all checked Python files already formatted. The Sprint 1 regression suite remains included.

## G. Supabase and RLS status

Supabase staging connectivity, database grants, role attributes, actual pooler mode, and `auth.uid()` identity propagation were not verified. No RLS is enabled or disabled by this schema revision, and no service-role credential was added. ADR-008 remains a hard gate before authenticated tenant queries.

## H. Known limits and deferred work

1. Apply and downgrade the revision against a disposable PostgreSQL/Supabase staging database; inspect the live constraints, indexes, and trigger behavior.
2. Test concurrent owner transfer/last-owner removal and manager transfer/last-manager removal under the intended isolation level and connection mode.
3. Before production, configure an application role without `BYPASSRLS`, appropriate table privileges, RLS policies, and a narrowly controlled activity-log writer boundary. The migration currently supplies an immutability trigger only.
4. Decide member departure/retention behavior when project roster rows, comments, task assignments, attendees, resources, or activity references remain.
5. Account lifecycle, invitation delivery/atomic consumption, workspace restore API, comment retention, activity retention/legal hold, hosting, and migration operator remain outside this sprint.

The pending invitation partial unique index follows the approved predicate on `accepted_at` and `revoked_at`; expired-but-unrevoked invitations continue to reserve their workspace/email pair until the invitation service revokes them.

## I. Sprint 3 readiness

At the time of this Sprint 2 report, Sprint 3 authentication was future work. Sprint 3 has since added JWT verification, profile provisioning, and membership authorization foundations; see [17](17-sprint-3-implementation-report.md). The schema/migration foundation remains ready for **staging validation**, not production tenant traffic. ADR-008 identity propagation and PostgreSQL lifecycle behavior still require actual database verification. No tenant API should rely on an unverified RLS path.

## J. Git status

Initial status was clean on the existing `backend/foundations` branch at the Sprint 1 verification commit. Work remained on that branch; no commit or push was performed. The Sprint 1 files were preserved. Final modified/new file inventory is the working-tree status at completion; no frontend files, `.env`, or secrets were added.

## Sprint 2.1 — lifecycle invariant hardening

Revision `0002_mvp_schema` was an untracked local file at the start of this review, and the worktree had no database URL, test database URL, or backend `.env`. I could not query every database where a copy may have been applied, so its external application status is **unknown**. I preserved `0002_mvp_schema` and added corrective revision `0003_lifecycle_hardening` instead of rewriting prior migration history. The new revision renames the prior function definitions temporarily so downgrade can restore the exact Sprint 2 triggers and functions.

The corrected Owner handlers explicitly branch on INSERT, UPDATE, and DELETE. They include both `OLD` and `NEW` workspace IDs on updates, deduplicate and sort the affected IDs, lock each surviving parent, and run deferred final-state checks. The Project Manager handlers explicitly cover all operations and tables. Project-member reassignment checks both project IDs; workspace-member changes find projects for both old and new workspace/user pairs. Parent locking takes workspace rows in UUID order before project rows, and deferred project checks inspect affected projects in UUID order.

The row triggers sort each event's parent set, but a multi-row statement can still acquire target tuple locks and per-row parent sets in executor order. Future membership services must lock the full affected workspace set and then project set in UUID order before issuing multi-row changes. PostgreSQL concurrency behavior has not been demonstrated; no concurrency-safety claim is made.

Added 15 PostgreSQL-only integration cases in `backend/tests/test_lifecycle_postgres.py`: first Owner creation, missing Owner, duplicate Owner, transfer, last-Owner removal, first Project Manager creation, missing Manager, manager transfer, workspace-member removal, two workspace-member reassignment outcomes, two project-member reassignment outcomes, concurrent Owner transfer, and concurrent Manager removal. They require a dedicated `_test` PostgreSQL database at revision 0003 with a minimal `auth.users(id)` stub. No such database was available, so all 15 were skipped and **zero lifecycle cases were exercised against PostgreSQL**. The existing static/unit suite, migration-chain checks, Alembic offline SQL generation, and Ruff checks are reported in final verification for this review.

Revision 0003 downgrade restores the prior 0002 lifecycle triggers and functions. Downgrading therefore reintroduces the old/new-parent behavior; use downgrade only as a deliberate rollback to that exact prior revision.
