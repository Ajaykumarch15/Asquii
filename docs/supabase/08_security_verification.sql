-- READ ONLY plus transaction-local identity probe. Run in a nonproduction SQL
-- session. Replace the test subject with a real nonprivileged Auth UUID.

SELECT current_user AS db_role,
       r.rolsuper,
       r.rolbypassrls,
       pg_has_role(current_user, 'authenticated', 'member') AS can_assume_authenticated
FROM pg_roles r
WHERE r.rolname = current_user;

SELECT current_setting('request.jwt.claim.sub', true) AS existing_transaction_subject,
       auth.uid() AS existing_auth_uid;

-- This demonstrates transaction-local setting mechanics only; it is not a signed
-- JWT verification and does not prove the application/session pool behavior.
BEGIN;
SELECT set_config(
    'request.jwt.claims',
    '{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated","aud":"authenticated"}',
    true
);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000000', true);
SELECT auth.uid() AS transaction_auth_uid,
       current_setting('request.jwt.claim.role', true) AS transaction_claim_role;
ROLLBACK;

-- After rollback, auth.uid() and request.jwt.claim.sub should not retain the
-- prior transaction-local subject. Repeat with alternating identities and both
-- commit/rollback on the same application-pooled physical connection.
SELECT current_setting('request.jwt.claim.sub', true) AS subject_after_rollback,
       auth.uid() AS auth_uid_after_rollback;

SELECT schemaname, tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
      'profiles', 'workspaces', 'workspace_members', 'workspace_invitations',
      'projects', 'project_members', 'milestones', 'tasks', 'task_subtasks',
      'task_comments', 'meetings', 'meeting_attendees', 'resources',
      'user_resource_preferences', 'activity_logs'
  )
ORDER BY tablename, policyname;

SELECT has_table_privilege(current_user, 'public.activity_logs', 'INSERT') AS can_insert_activity,
       has_table_privilege(current_user, 'public.activity_logs', 'UPDATE') AS can_update_activity,
       has_table_privilege(current_user, 'public.activity_logs', 'DELETE') AS can_delete_activity,
       has_table_privilege(current_user, 'public.activity_logs', 'TRUNCATE') AS can_truncate_activity;
