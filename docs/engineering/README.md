# Engineering documentation index

Sprint 0 and Sprint 0.5 audit and architecture validation, based on source inspection as of 2026-11-03. Frontend source remains unchanged; no backend/schema exists. Decisions below apply to proposed MVP.

| # | Document | Purpose |
|---|---|---|
| 1 | [01-repository-audit.md](01-repository-audit.md) | Verified repository, stack and limitations |
| 2 | [02-frontend-screen-inventory.md](02-frontend-screen-inventory.md) | 11 screens and state-based navigation |
| 3 | [03-screen-to-backend-mapping.md](03-screen-to-backend-mapping.md) | Screen requirements aligned to final policy |
| 4 | [04-product-module-analysis.md](04-product-module-analysis.md) | UI/backend/future module status |
| 5 | [05-system-architecture.md](05-system-architecture.md) | React/Auth/FastAPI/SQLAlchemy/Postgres flow |
| 6 | [06-database-design.md](06-database-design.md) | Tables, constraints, indexes, deletion and RLS |
| 7 | [07-database-er-diagram.md](07-database-er-diagram.md) | Mermaid entity relationships |
| 8 | [08-authentication-authorization.md](08-authentication-authorization.md) | Identity, fixed roles, RLS context and staging tests |
| 9 | [09-api-specification.md](09-api-specification.md) | Proposed `/api/v1` API contract |
| 10 | [10-frontend-integration-plan.md](10-frontend-integration-plan.md) | Incremental integration plan |
| 11 | [11-security-review.md](11-security-review.md) | Threats and controls |
| 12 | [12-development-roadmap.md](12-development-roadmap.md) | Sprint 0–9 sequence |
| 13 | [13-sprint-1-implementation-plan.md](13-sprint-1-implementation-plan.md) | Foundation-only Sprint 1 plan |
| 14 | [14-architecture-decisions.md](14-architecture-decisions.md) | MVP architecture decision records |

## Finalized MVP decisions

- FastAPI modular monolith; Supabase Auth owns identity.
- Workspace roles Owner/Admin/Member; exactly one active Owner stored only in `workspace_members`; no generic RBAC.
- Project roles Project Manager/Project Member; Owner/Admin override.
- Every active workspace member reads every active project; project membership grants collaboration writes; private projects deferred.
- Composite tenant/project FKs; RLS plus independent FastAPI authorization; resource stars are user-specific; activity logs are trusted-backend append-only.
- Notifications are conditional. Teams, custom roles, Guest/Viewer, private projects, reports and binary storage are not MVP schema commitments.

## Remaining UNKNOWN

Deployment/hosting/region, Python/dependency tool, Supabase signing/grants/pool mode, direct SQLAlchemy versus Data API (staging validation required), migration executor, CI, invitation email provider, deletion/retention details, timezone display preference, notification persistence/delivery, file storage, prototype data retention, compliance/backup/monitoring, and final prioritization of task/meeting/resource capabilities.
