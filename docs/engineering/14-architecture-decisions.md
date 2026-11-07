# 14 — Architecture decision records

Status: Sprint 0.5 decisions for MVP architecture. Sprint 2 implements the approved relational schema in SQLAlchemy and Alembic. Sprint 3 adds access-token authentication, current-profile provisioning, and reusable authorization foundations; domain APIs, RLS policy deployment, and provider-specific operational facts remain future work or UNKNOWN. See [16](16-sprint-2-implementation-report.md) and [17](17-sprint-3-implementation-report.md) for implementation and verification status.

## ADR-001 — Modular monolith

**Decision:** Build one FastAPI application organized by domain modules and service/repository boundaries.

**Rationale:** Current product is a compact workspace/project app; one deployable keeps transactions, authorization, and operations straightforward.

**Consequences:** Modules can evolve independently inside one process; API contracts remain explicit. Scale/deploy boundaries are not yet justified.

**Alternatives rejected:** Microservices (operational and consistency cost without evidence of scale); one unstructured router (weak domain boundaries).

**Implementation implications:** Keep auth, users, workspaces, members/invitations, projects, tasks, meetings, resources, activity, and optional notification modules separated. Share transaction/session utilities.

**Deferred:** Hosting topology, background jobs, service extraction thresholds.

## ADR-002 — Supabase Auth owns identity

**Decision:** Use Supabase Auth for identity, credentials, verification, reset, and refresh; `profiles.user_id` references `auth.users.id`.

**Rationale:** Matches selected stack and avoids credential duplication.

**Consequences:** API validates Supabase JWT; profile lifecycle and Auth deletion handling must be defined.

**Alternatives rejected:** App-managed password store (duplicate security surface); trusting frontend persona IDs.

**Implementation implications:** React Supabase Auth SDK; bearer JWT to FastAPI; no password column or service key in browser.

**Deferred:** Email/domain policy, identity deletion/retention, SSO/MFA requirements.

## ADR-003 — Workspace ownership lives in membership

**Decision:** `workspace_members` is authoritative; no `workspaces.owner_id`. Exactly one active Owner per active workspace.

**Rationale:** One membership source of truth avoids owner/member duplication and naturally scopes ownership to tenant membership.

**Consequences:** Creation and ownership transfer are transactional. A partial unique index guarantees at most one active Owner; a transaction/deferred invariant guarantees at least one.

**Alternatives rejected:** Nullable owner_id (duplicate relation); multiple implicit owners.

**Implementation implications:** Atomic workspace+Owner insert; transfer promotes successor/demotes predecessor; prevent owner removal until transfer.

**Deferred:** What happens if Auth account is deleted or workspace is archived.

## ADR-004 — Fixed workspace roles

**Decision:** MVP roles are Owner, Admin, Member; no Guest/custom permissions table. Owner/Admin manage members/invitations and settings; Owner/Admin create projects; Members read all active workspace projects.

**Rationale:** Small explicit model fits confirmed Sprint 0.5 direction and visible prototype Admin/Member patterns.

**Consequences:** Role values constrained in DB and Pydantic; Owner transfer is special operation.

**Alternatives rejected:** Generic roles/permissions tables; Guest and custom roles (not needed in MVP).

**Implementation implications:** Server and RLS checks must agree; existing UI role checks are not authority and UI currently has no Owner value.

**Deferred:** Member self-leave policy; ownership succession on account closure.

## ADR-005 — Fixed project roles

**Decision:** Project roles are Project Manager and Project Member. Workspace Owner/Admin have administrative override. Project Manager controls project settings and membership; both project roles can manage permitted content.

**Rationale:** Separates workspace administration from collaboration responsibilities while keeping role count small.

**Consequences:** Project members must be workspace members; no Viewer/custom role.

**Alternatives rejected:** Viewer and generic RBAC (deferred complexity); relying solely on workspace roles.

**Implementation implications:** `project_members.role` check constraint, last-manager removal guard, composite membership FK.

**Deferred:** Whether workspace Admin override is visible as a project role in UI (it should not be duplicated in storage).

## ADR-006 — Workspace-wide project visibility

**Decision:** Every active workspace member reads every active project in that workspace. Project membership controls collaboration/write access. Non-project members are read-only. Private project visibility is deferred.

**Rationale:** Explicit MVP policy resolves current ambiguity and supports workspace portfolio screens.

**Consequences:** RLS must not filter project SELECT by project_members; child records are readable workspace-wide for active projects.

**Alternatives rejected:** Private/member-only project reads (conflicts with default MVP policy).

**Implementation implications:** Filter only by active workspace membership and project archive state; writes require admin override or project membership.

**Deferred:** Private projects or project-level confidentiality.

## ADR-007 — Composite cross-tenant integrity

**Decision:** Carry `workspace_id` on project-owned rows and use composite keys/FKs to ensure project and user references belong to the same workspace/project.

**Rationale:** Independent foreign keys do not prevent cross-tenant mismatches.

**Consequences:** More composite constraints and explicit transaction data; safer integrity.

**Alternatives rejected:** Service-only checks (can be bypassed by maintenance SQL); generic unconstrained UUID links.

**Implementation implications:** Unique `(id,workspace_id)` on projects; project membership FK to workspace_members; assignee/attendee/resource owner FK to project_members.

**Deferred:** Whether a future denormalization is needed for query speed; benchmark first.

## ADR-008 — RLS with explicit end-user transaction identity

**Decision:** Enable RLS for app tenant tables. FastAPI also authorizes every operation. For SQLAlchemy direct connections, establish validated JWT identity in transaction-local PostgreSQL settings/role before tenant queries, use DB login without BYPASSRLS, and verify actual Supabase grants. If reliable context propagation cannot be established, use Supabase Data API with end-user JWT for RLS-scoped operations.

**Rationale:** Layered tenant isolation while retaining FastAPI business rules.

**Consequences:** Pooling and role grants must be tested; RLS policy alone is not application authorization.

**Alternatives rejected:** Service-role credentials for normal requests (bypass RLS); session-level identity settings (pool leakage risk); disabling RLS.

**Implementation implications:** Transaction-scoped `SET LOCAL`/`set_config(..., true)`, bound values, pool rollback/reset behavior, staging tests under real pooler.

**Deferred:** Final direct SQL versus Data API split; actual provider role/grant details are UNKNOWN until staging verification.

## ADR-009 — Resource stars are user preferences

**Decision:** Store per-user stars in `user_resource_preferences`, not shared `resources.starred`.

**Rationale:** Starred state is personal UI preference and should not overwrite another user's state.

**Consequences:** Resource list may join the current user's preference.

**Alternatives rejected:** Global boolean on resource.

**Implementation implications:** Own-row RLS and idempotent upsert/delete API.

**Deferred:** Additional personal resource preferences (view mode, pinned ordering).

## ADR-010 — Append-only activity log

**Decision:** Add `activity_logs` for trusted backend-generated domain events with workspace/project scope, nullable actor only for system events, and constrained JSONB metadata.

**Rationale:** Auditable changes support collaboration and security review; current UI lacks a feed, but server audit events are justified operationally.

**Consequences:** Writes occur atomically with mutations; retention and read UX need policy.

**Alternatives rejected:** Client-authored activity (forgeable); broad JSONB product store (unqueryable and weak integrity).

**Implementation implications:** No client write policy; app DB role gets insert only through trusted code and no update/delete; indexes by tenant/time and entity.

**Deferred:** Retention duration, export/legal hold, which events are user-visible.

## ADR-011 — MVP data scope

**Decision:** Core schema includes workspace/project/membership/invitation, milestone, task/subtask/comment, meeting/attendee, resource/user preference, and activity log. Notification tables are conditional. Teams, private projects, guests/viewers, reports, binary storage, and custom roles are not MVP schema requirements.

**Rationale:** Ground design in present screens and explicit role/visibility decisions; avoid inventing unsupported teams/storage.

**Consequences:** Some prototype affordances (team filter, upload metadata, derived notification feed) remain placeholders until scoped.

**Alternatives rejected:** Implement every UI hint as a backend module.

**Implementation implications:** Build only after product prioritization; status enums match exact model values.

**Deferred:** Which task/collaboration modules ship in MVP; notification persistence/delivery; uploads; CSV bulk APIs.

## Sprint 0.5.1 clarifications (supersede any less-specific wording above)

### ADR-003 clarification — Enforce exactly one active Owner

A partial unique index alone guarantees only **at most one** Owner. The required invariant is **exactly one** Owner for every non-archived workspace at each committed transaction boundary. Enforce at most one with the partial unique index and at least one with a deferred constraint trigger (or equivalent database constraint mechanism) that checks the final transaction state on workspace creation and active membership mutations. Creation inserts workspace and initial Owner in one transaction. Ownership transfer is a single controlled transaction that locks the workspace row, validates the successor is an active member, promotes that member and demotes the current Owner, then commits. Revoke ordinary direct mutation privileges that could bypass the operation. Owner removal/demotion without a transfer is rejected. Staging tests must run concurrent transfers and attempted owner removal and prove one Owner remains; the unique index alone is not accepted as proof.

### ADR-008 clarification — Direct SQLAlchemy RLS is unverified and conditional

No Supabase staging project or connection was available during this documentation sprint, so none of the following is verified: app role lacks `BYPASSRLS`; it can safely assume the intended `authenticated` role; JWT claim settings are transaction-local; `auth.uid()` resolves the intended subject; pooled connections do not retain identity; and the actual Supabase pooler supports this flow. Direct SQLAlchemy access is **not approved for RLS-scoped requests until every check passes in staging**. Test the deployed grants and role membership, set claims inside an explicit transaction using local settings, compare `auth.uid()` with the verified JWT subject, and reuse the same pooled connection across alternating users after both commit and rollback. Test through the actual chosen pooler. If role assumption or any other condition fails or cannot be demonstrated, use Supabase Data API with the user's JWT for RLS-scoped operations. Never use service-role credentials as fallback.

### ADR-010 clarification — Enforce activity immutability and trusted writes

`activity_logs` has no client INSERT policy and ordinary application credentials receive no UPDATE or DELETE permission. Events originate in trusted backend code and are inserted in the same transaction as the business mutation. A subtle privilege boundary applies: if the normal request DB credential can directly insert events, PostgreSQL grants cannot distinguish trusted application code from arbitrary code using that credential. Preferred enforcement is a narrowly scoped database function with fixed `search_path`, constrained parameters, no public execute, and narrowly granted execute, or a separate privileged writer credential available only to the event-writing path. Do not grant general table INSERT to the ordinary request role. Review function ownership and RLS behavior so the controlled mechanism cannot become a tenant bypass. Retention, legal hold and archival period are a separate explicit policy; no automatic purge until decided.

## ADR-012 — Workspace archive lifecycle

**Decision:** Archiving a workspace sets `workspaces.archived_at` and writes an activity event atomically. It does not delete or rewrite membership rows or project `archived_at` values. All workspace access and project/child access is denied while the workspace is archived. Pending invitations are revoked in the same transaction. Membership rows remain for audit and possible restore; restoring the workspace reactivates prior memberships and any projects that were not independently archived. Archived workspace slugs remain reserved. No hard-delete endpoint exists in MVP.

**Rationale:** Reversible lifecycle and retention without losing prior project archive state.

**Consequences:** Every RLS/API access check includes active workspace state; invitation revocation needs transactional handling.

**Alternatives rejected:** Cascading hard deletion; archiving each project on workspace archive (would lose distinction between independently archived projects and inherited unavailability).

**Implementation implications:** Workspace archive/restore is atomic; suppress/revoke outstanding invitations; activity event records archive/restore actor.

**Deferred:** Whether restore is supported in UI/API and workspace-level retention/purge timetable.

## ADR-013 — Every active project has a Project Manager

**Decision:** Every active project must have at least one active `Project Manager`. Project creation inserts the creator as Project Manager atomically. Project Manager demotion/removal is rejected unless another manager is added in the same transaction. Archiving a project exempts it from the invariant; restoring requires a manager before commit.

**Rationale:** Project-level settings and membership operations need an accountable manager without depending on workspace admins.

**Consequences:** The current prototype permits projects with empty `personIds`; integration must assign creator/manager on create. Owner/Admin override remains available without storing them as project members.

**Alternatives rejected:** Allowing managerless projects and relying on workspace admins indefinitely.

**Implementation implications:** Deferred constraint trigger checks at commit for active projects; mutations lock project row; composite FK ensures manager is a workspace member. Concurrent manager removals must be serialized and tested.

**Deferred:** UI affordance for assigning multiple managers and behavior when manager loses workspace membership (reject removal or transfer first; transfer is required by default).

