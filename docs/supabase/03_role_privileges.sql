-- READ ONLY. Run as the same login used by the FastAPI application when possible.
-- Do not infer the application role from an operator or SQL Editor session.

SELECT current_user AS inspected_role,
       r.rolsuper,
       r.rolbypassrls,
       r.rolcreaterole,
       r.rolcreatedb,
       r.rolcanlogin
FROM pg_roles r
WHERE r.rolname = current_user;

SELECT member_role.rolname AS member_role,
       granted_role.rolname AS granted_role,
       membership.admin_option
FROM pg_auth_members membership
JOIN pg_roles granted_role ON granted_role.oid = membership.roleid
JOIN pg_roles member_role ON member_role.oid = membership.member
WHERE member_role.rolname = current_user
ORDER BY granted_role.rolname;

SELECT table_name,
       coalesce(has_table_privilege(current_user, to_regclass(format('public.%I', table_name)), 'SELECT'), false) AS can_select,
       coalesce(has_table_privilege(current_user, to_regclass(format('public.%I', table_name)), 'INSERT'), false) AS can_insert,
       coalesce(has_table_privilege(current_user, to_regclass(format('public.%I', table_name)), 'UPDATE'), false) AS can_update,
       coalesce(has_table_privilege(current_user, to_regclass(format('public.%I', table_name)), 'DELETE'), false) AS can_delete,
       coalesce(has_table_privilege(current_user, to_regclass(format('public.%I', table_name)), 'TRUNCATE'), false) AS can_truncate
FROM (VALUES
    ('profiles'), ('workspaces'), ('workspace_members'), ('workspace_invitations'),
    ('projects'), ('project_members'), ('milestones'), ('tasks'), ('task_subtasks'),
    ('task_comments'), ('meetings'), ('meeting_attendees'), ('resources'),
    ('user_resource_preferences'), ('activity_logs')
) AS app_tables(table_name)
ORDER BY table_name;

-- Ownership is a separate privilege path and can bypass ordinary grants/RLS rules.
SELECT c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner_role,
       c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user) AS current_role_owns_table
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
  AND c.relname IN (
      'profiles', 'workspaces', 'workspace_members', 'workspace_invitations',
      'projects', 'project_members', 'milestones', 'tasks', 'task_subtasks',
      'task_comments', 'meetings', 'meeting_attendees', 'resources',
      'user_resource_preferences', 'activity_logs'
  )
ORDER BY c.relname;
