-- Asquii least-privilege application role (Sprint 11b step 3).
--
-- The application must NOT connect using the Supabase `postgres` admin role:
-- that role carries BYPASSRLS and owner rights, so a bug in app code could
-- read or corrupt any object. `asquii_app` receives only what the API needs.
--
-- The two MODE markers (file://__ASQUII_APP_PASSWORD__ and
-- file://__ASQUII_DB_NAME__) are substituted by
-- backend/scripts/apply_app_role.py. Run migrations with the admin URL
-- (DATABASE_MIGRATE_URL); the app connects with this role (DATABASE_URL).
--
-- Features deliberately withheld: BYPASSRLS, SUPERUSER, CREATEROLE,
-- CREATEDB, replication, ownership of tables, and any access to the Supabase
-- auth schema, alembic_version (migrated as admin), and the legacy
-- asquii_db_probe table (unreferenced by application code).
--
-- Idempotence: re-running with an existing role performs ALTER ROLE (role
-- existence is handled by the applier script, not inside DO blocks, so no
-- dynamic quote-quoting formatting is needed).

-- =====================================================================
-- Role (marker replaced with a validated, quote-free password literal).
-- =====================================================================
CREATE ROLE asquii_app LOGIN PASSWORD '__ASQUII_APP_PASSWORD__'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- =====================================================================
-- Connection and schema usage.
-- =====================================================================
GRANT CONNECT ON DATABASE __ASQUII_DB_NAME__ TO asquii_app;
GRANT USAGE ON SCHEMA public TO asquii_app;

-- =====================================================================
-- Tables owned by the application (15 UUID-keyed tables; none of the
-- app primary keys uses sequences, so no sequence grants are required).
-- =====================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.activity_logs, public.meeting_attendees, public.meetings, public.milestones, public.profiles, public.project_members, public.projects, public.resources, public.task_comments, public.task_subtasks, public.tasks, public.user_resource_preferences, public.workspace_invitations, public.workspace_members, public.workspaces TO asquii_app;

-- =====================================================================
-- Future-proofing: tables created by later migrations (run as `postgres`)
-- are granted automatically, without touching Supabase-owned objects.
-- =====================================================================
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO asquii_app;
