-- READ ONLY. Run in Supabase SQL Editor before any schema or privilege change.
-- Do not paste connection strings, access tokens, or keys into this script.

SELECT current_database() AS database_name,
       current_user AS current_role,
       session_user AS login_role,
       current_setting('transaction_read_only') AS transaction_read_only;

-- Flags for the current login and standard Supabase roles, when present.
SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin
FROM pg_roles
WHERE rolname IN (current_user, session_user, 'anon', 'authenticated', 'service_role', 'postgres')
ORDER BY rolname;

-- Identity-context probe: does not display the entire JWT claims setting.
SELECT to_regprocedure('auth.uid()') AS auth_uid_function,
       auth.uid() AS resolved_auth_uid,
       current_setting('request.jwt.claim.sub', true) AS transaction_subject,
       current_setting('request.jwt.claim.role', true) AS transaction_role;

-- Migration marker presence; query public.alembic_version only if this returns true.
SELECT to_regclass('public.alembic_version') IS NOT NULL AS alembic_version_table_exists;

-- Application table inventory and RLS flags.
SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS rls_forced,
       pg_get_userbyid(c.relowner) AS owner_role
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
      'profiles', 'workspaces', 'workspace_members', 'workspace_invitations',
      'projects', 'project_members', 'milestones', 'tasks', 'task_subtasks',
      'task_comments', 'meetings', 'meeting_attendees', 'resources',
      'user_resource_preferences', 'activity_logs'
  )
ORDER BY c.relname;

-- Current policies, if any.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
      'profiles', 'workspaces', 'workspace_members', 'workspace_invitations',
      'projects', 'project_members', 'milestones', 'tasks', 'task_subtasks',
      'task_comments', 'meetings', 'meeting_attendees', 'resources',
      'user_resource_preferences', 'activity_logs'
  )
ORDER BY tablename, policyname;

-- Append-only trigger presence.
SELECT t.tgname, c.relname AS table_name, pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'activity_logs'
  AND NOT t.tgisinternal;
