# 12 — Development roadmap (Sprint 0.5 validated)

Decisions are finalized in [14](14-architecture-decisions.md). Sprint 1 is foundation only. MVP roles and visibility are fixed; conditional modules remain gated.

| Sprint | Objectives and dependencies | Deliverables / acceptance | Risks |
|---|---|---|---|
| 0 — Audit | Inspect repository and prepare initial blueprint | 13 docs; source untouched (complete) | Checkout may omit context |
| 0.5 — Architecture validation | Reconcile docs; finalize roles, visibility, schema, RLS, APIs and ADRs | 14 docs plus index aligned; source untouched (complete) | Supabase grants/pooling need staging proof |
| 1 — Foundation | Python/runtime, hosting, Supabase staging access, pool and migration ownership decided | FastAPI scaffold, typed config, structured logging, health/readiness, SQLAlchemy connectivity, Alembic empty baseline, request ID, CORS, basic tests, nonproduction connectivity verification. No auth/product tables/CRUD/frontend integration. | Infrastructure choices unknown; RLS context needs empirical validation |
| 2 — Auth/profile | Sprint 1 and Supabase Auth configuration | SDK session integration, API JWT validation, `/me`, profile; identity tests | Email policy and account retention |
| 3 — Workspace | Auth and finalized schema | Workspace lifecycle, exactly one Owner, atomic transfer, settings, membership/RLS tests | Concurrency and owner invariant |
| 4 — Members/invitations | Workspace and email provider | Owner/Admin membership and invitation operations; verified matching acceptance; idempotency/rate limits | Deliverability and replay prevention |
| 5 — Projects/collaboration | Workspace and roles | Project CRUD/archive, project membership, milestones, exact status constraints; tasks/meetings/resources by product priority | Team UI/model mismatch; feature breadth |
| 6 — Frontend integration | Stable APIs and auth UX decision | Existing UI connected incrementally with loading/error states and no redesign; prototype data migration/disposal decision | Local data loss, schema mismatch |
| 7 — Activity/notifications | Mutation events and notification scope | Backend-originated append-only activity; notifications only if durable behavior approved | Retention/delivery scope |
| 8 — Hardening | Feature-complete staging | Cross-tenant/RLS tests, rate limits, backup/restore drill, monitoring and review | Compliance/SLO targets unknown |
| 9 — Production | Hosting, domain, region, secrets, backup and monitoring decisions | Controlled deploy, migration/rollback/runbooks, restore/alert validation | Cost and operations ownership unknown |

Teams, custom roles, Guest/Viewer, private projects, binary storage, reports and notification delivery are not MVP commitments. Task/meeting/resource UI exists; delivery order remains subject to product prioritization.
