-- READ ONLY. Compare the target schema with migrations 0002 and 0003.
-- Missing tables appear as absent rows; do not create or drop tables from this report.

SELECT expected.table_name,
       to_regclass(format('public.%I', expected.table_name)) IS NOT NULL AS exists
FROM (VALUES
    ('profiles'), ('workspaces'), ('workspace_members'), ('workspace_invitations'),
    ('projects'), ('project_members'), ('milestones'), ('tasks'), ('task_subtasks'),
    ('task_comments'), ('meetings'), ('meeting_attendees'), ('resources'),
    ('user_resource_preferences'), ('activity_logs')
) AS expected(table_name)
ORDER BY expected.table_name;

SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
      'profiles', 'workspaces', 'workspace_members', 'workspace_invitations',
      'projects', 'project_members', 'milestones', 'tasks', 'task_subtasks',
      'task_comments', 'meetings', 'meeting_attendees', 'resources',
      'user_resource_preferences', 'activity_logs'
  )
ORDER BY table_name, ordinal_position;

SELECT conrelid::regclass AS table_name,
       conname,
       contype,
       condeferrable,
       condeferred,
       pg_get_constraintdef(oid, true) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND conrelid::regclass::text IN (
      'public.profiles', 'public.workspaces', 'public.workspace_members',
      'public.workspace_invitations', 'public.projects', 'public.project_members',
      'public.milestones', 'public.tasks', 'public.task_subtasks',
      'public.task_comments', 'public.meetings', 'public.meeting_attendees',
      'public.resources', 'public.user_resource_preferences', 'public.activity_logs'
  )
ORDER BY conrelid::regclass::text, conname;

SELECT schemaname, tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
      'workspace_members', 'project_members', 'tasks', 'meeting_attendees',
      'resources', 'user_resource_preferences', 'activity_logs'
  )
ORDER BY tablename, indexname;

-- Alembic's database revision, if its marker table exists.
DO $$
BEGIN
    IF to_regclass('public.alembic_version') IS NULL THEN
        RAISE NOTICE 'public.alembic_version is absent; no Alembic revision has been recorded here';
    ELSE
        RAISE NOTICE 'Query revision with: SELECT version_num FROM public.alembic_version';
    END IF;
END $$;
