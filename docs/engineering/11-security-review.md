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

## RLS policy model

Enable RLS for every application tenant table; default deny. Active workspace membership permits workspace-wide project and child content SELECT, including non-project members. Writes require Owner/Admin override or project membership, except project settings/membership require Owner/Admin or Project Manager. Workspace membership/invitations are Owner/Admin managed; project membership is Owner/Admin/Project Manager managed; recipient/user preferences are self-only. Activity logs are workspace-visible and have no client write/update/delete. Conditional notifications require recipient membership. Database composite constraints complement policy predicates.

FastAPI authorization and RLS are separate controls. FastAPI performs action-level business checks, field validation, role transitions and safe errors. RLS constrains SQL access even if service code misses a tenant filter. Policies must avoid recursive membership checks; use narrowly scoped helper functions only with fixed `search_path`, minimized grants and review of `SECURITY DEFINER` ownership. Staging verifies `auth.uid()` claims, grants, `BYPASSRLS`, actual pooler mode, and user context reset. If direct SQLAlchemy context cannot be demonstrated reliable, route RLS-scoped operations through Supabase Data API using the end-user JWT.

## Operational UNKNOWNs

Hosting, region/data residency, compliance, secret manager, monitoring vendor/SLO, email delivery, retention periods, backup tier, upload scanning, production OpenAPI visibility, pooler/grants and final SQLAlchemy/Data API split remain unknown. Do not connect Sprint 0.5 verification to production.
