# 11 — Security review (validated strategy)

| Risk | Control and verification |
|---|---|
| Persona/role spoofing | Supabase identity; JWT validation; resolve active roles from DB per request; never trust request body. |
| Cross-workspace/project IDOR | FastAPI scoped service queries plus RLS; composite FKs for same-tenant memberships/assignees/attendees/resource owners; test cross-tenant reads/writes. |
| RLS bypass from backend | Dedicated app DB role without `BYPASSRLS`; verify actual Supabase grants/role membership in staging; no service-role key in normal request path. |
| Connection identity leakage | Transaction-local validated claims and role only; explicit transaction; test pool reuse after commit/rollback under actual pooler. No session-level SET. |
| Bad JWT/key rotation | Verify signature/JWKS, issuer, audience, exp/nbf and subject; cache keys safely; fail closed. |
| Owner invariant race | Partial unique active-Owner index (at most one) plus transactional/deferred exactly-one invariant; serialize transfer and test concurrent operations. |
| Cross-project assignments | Composite FKs require assignee, meeting attendee, resource owner to be project member and workspace member. |
| Invitation replay/enumeration | Lowercase/trim email; unique active pending index; hash token only; expiry and verified email match; atomic consume; rate limit; generic responses. |
| SQL injection | SQLAlchemy bound values; allowlist filters/order; no string-built SQL. |
| XSS/unsafe links | React escaping; validate URL schemes, disallow javascript/data URLs; safe external-link attributes. |
| Upload abuse (conditional) | Private storage, short-lived signed URLs scoped by project/object, MIME/size limits and scanning decision before enabling. |
| CORS/abuse | Explicit origin allowlist, no wildcard credential mode; request size/rate limits. |
| PII/log leakage | Structured logs and request IDs; redact JWTs, secrets, invitation tokens and unnecessary user content. |
| Audit tampering | Activity events backend-originated in same transaction; client cannot write; append-only DB grants/RLS; controlled retention. |
| Data loss | Define backup/PITR tier and run restore drills before production; archive semantics preserve active data. |

## Sprint 3 authentication controls and status

The API accepts only a Bearer token that passes signature, explicit algorithm allowlist, configured issuer/audience, required claim, expiration/not-before, and UUID-subject validation. JWKS URLs are fixed server configuration (defaulting to the configured Supabase host); JWT headers cannot choose a URL. Unknown keys and key endpoint failures fail closed. PyJWT parse/signature/key exceptions are returned only as generic authentication errors. Email is optional verified claim data. User metadata and the token's generic role claim are not used for authorization.

Authorization helpers query current, non-removed workspace memberships and active projects; decisions are not cached between requests. Workspace Owner/Admin administration override and Project Manager/member collaboration rules follow ADR-004 through ADR-006. The current-user endpoint uses the verified subject and idempotent PostgreSQL profile insertion. Unit tests cover cryptographic verification and policy outcomes; direct PostgreSQL/Supabase membership and provisioning behavior remains unverified without a disposable integration database.

ADR-008 remains unverified. Sprint 9 adds transaction-local `request.jwt.claims` and `request.jwt.claim.sub` settings from the verified JWT subject at SQLAlchemy transaction begin; it does not assume the `authenticated` PostgreSQL role. No RLS policy is enabled by application migrations. Before relying on RLS, validate the configured app role, `BYPASSRLS`, `auth.uid()` subject mapping, transaction-local reset, and pooled connection reuse against the actual staging pooler, or choose the documented Supabase Data API fallback. Never treat a service-role key as end-user identity.

Sprint 8 adds workspace/project activity feeds with API-level membership and parent-scope checks, left-joined safe actor display names, and recursive removal of known private metadata keys. The database migration installs an append-only trigger that rejects activity UPDATE/DELETE. It does not enforce who may INSERT: services insert `ActivityLog` using the shared SQLAlchemy session, and this repository contains no production role grants or narrow activity-writer function. The deployed application's `INSERT`, `UPDATE`, and `DELETE` privileges are unknown. ADR-010 therefore remains unresolved; do not infer a database-enforced trusted-writer boundary from use of application helper functions. Resolve only after reviewing real grants and deploying/testing a narrowly scoped writer mechanism.

## RLS policy model

Enable RLS for every application tenant table; default deny. Active workspace membership permits workspace-wide project and child content SELECT, including non-project members. Writes require Owner/Admin override or project membership, except project settings/membership require Owner/Admin or Project Manager. Workspace membership/invitations are Owner/Admin managed; project membership is Owner/Admin/Project Manager managed; recipient/user preferences are self-only. Activity logs are workspace-visible and have no client write/update/delete. Conditional notifications require recipient membership. Database composite constraints complement policy predicates.

FastAPI authorization and RLS are separate controls. FastAPI performs action-level business checks, field validation, role transitions and safe errors. RLS constrains SQL access even if service code misses a tenant filter. Policies must avoid recursive membership checks; use narrowly scoped helper functions only with fixed `search_path`, minimized grants and review of `SECURITY DEFINER` ownership. Staging verifies `auth.uid()` claims, grants, `BYPASSRLS`, actual pooler mode, and user context reset. If direct SQLAlchemy context cannot be demonstrated reliable, route RLS-scoped operations through Supabase Data API using the end-user JWT.

## Operational UNKNOWNs

Hosting, region/data residency, compliance, secret manager, monitoring vendor/SLO, email delivery, retention periods, backup tier, upload scanning, production OpenAPI visibility, pooler/grants and final SQLAlchemy/Data API split remain unknown. Do not connect Sprint 0.5 verification to production.

## Sprint 2 schema controls and limitations

Revision `0002_mvp_schema` implements composite tenant foreign keys and check constraints for approved role and lifecycle values. Deferred triggers guard exactly one active Owner and at least one active Project Manager, with parent-row locks during the final-state check. An activity-log trigger rejects row updates and deletes. No RLS policies or role grants are installed by this revision. The activity trigger does not restrict inserts and can be bypassed by sufficiently privileged database owners; production role grants and trusted event-write boundaries remain mandatory.

No Supabase staging connection or disposable PostgreSQL test URL was available for this implementation. Thus FK/check/index enforcement, deferred-trigger race handling, migration upgrade/downgrade, and behavior of trigger queries under future RLS policies remain unverified at runtime. Do not expose tenant APIs until these controls are exercised against the actual staging database/pooler and the ADR-008 identity strategy is proven.

### Sprint 2.1 lifecycle correction

Revision `0003_lifecycle_hardening` preserves `0002_mvp_schema` and replaces its lifecycle functions. Row-level lock functions take old/new workspace IDs in UUID order, then project IDs in UUID order; deferred checks evaluate every affected old/new parent in the same order. Multi-row statements can still acquire row and parent locks in executor order. Future service transactions must lock the complete affected parent set in sorted order before issuing multi-row membership changes. No concurrency guarantee is claimed until the PostgreSQL race tests run against the intended isolation level and pooler.
