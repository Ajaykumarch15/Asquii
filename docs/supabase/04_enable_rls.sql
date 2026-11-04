-- REVIEW DRAFT ONLY. DO NOT RUN INDEPENDENTLY.
-- RLS enablement, grants, and policies must be combined into one reviewed,
-- versioned migration after disposable PostgreSQL tests pass. Enabling RLS
-- without matching policies can make application requests fail closed.

BEGIN;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.milestones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_attendees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_resource_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- FORCE ROW LEVEL SECURITY is intentionally not automatic here. Consider it per
-- table only after 01/03 show the table owner and migration role and tests prove
-- trigger/function behavior. Superusers and BYPASSRLS roles still bypass FORCE.
-- Example (operator must review each table separately):
-- ALTER TABLE public.workspaces FORCE ROW LEVEL SECURITY;

COMMIT;
