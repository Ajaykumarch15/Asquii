-- READ ONLY. Checks object presence and definitions; it does not prove runtime
-- trigger correctness or concurrency behavior.

SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid, true) AS definition
FROM pg_constraint
WHERE conname IN (
    'workspace_exactly_one_active_owner',
    'project_at_least_one_active_manager',
    'uq_workspace_members_active_owner',
    'uq_meetings_workspace_project_id',
    'fk_tasks_workspace_id_project_members',
    'fk_meeting_attendees_workspace_id_project_members',
    'fk_resources_workspace_id_project_members',
    'fk_task_comments_workspace_id_project_members'
)
ORDER BY conname;

SELECT n.nspname AS schema_name,
       c.relname AS table_name,
       t.tgname AS trigger_name,
       t.tgdeferrable,
       t.tginitdeferred,
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal
  AND (t.tgname LIKE '%owner%invariant%'
       OR t.tgname LIKE '%manager%invariant%'
       OR t.tgname = 'activity_logs_immutable')
ORDER BY c.relname, t.tgname;

-- The queries above are catalog checks only. Owner/manager transfer, last-member
-- removal, FK rejection, immutability, rollback, and concurrency require a
-- disposable PostgreSQL integration suite; never test by mutating production.
