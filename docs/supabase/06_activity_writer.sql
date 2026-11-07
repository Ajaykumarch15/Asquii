-- DRAFT ONLY. OPERATOR/SECURITY APPROVAL REQUIRED. NOT EXECUTED.
-- This creates a constrained candidate writer function but grants it to NO role.
-- The existing Sprint 4-8 helpers still insert ActivityLog ORM rows directly;
-- this function does not resolve ADR-010 until those centralized helpers are
-- migrated to call it and only a verified, isolated writer path can execute it.
-- The function owner must be reviewed and able to insert while respecting RLS.

BEGIN;

CREATE OR REPLACE FUNCTION private.write_activity(
    p_workspace_id uuid,
    p_project_id uuid,
    p_action text,
    p_entity_type text,
    p_entity_id uuid,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
SET row_security = 'off'
AS $$
DECLARE
    resolved_actor uuid := auth.uid();
    new_activity_id uuid;
BEGIN
    IF resolved_actor IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Authenticated activity actor required';
    END IF;
    IF p_action IS NULL OR length(p_action) > 100
       OR p_action !~ '^(workspace|project|task|meeting|resource)\.[a-z_]+$' THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Unsupported activity action';
    END IF;
    IF p_entity_type IS NULL OR length(p_entity_type) > 100 OR p_entity_id IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid activity entity';
    END IF;
    IF p_metadata IS NULL OR jsonb_typeof(p_metadata) <> 'object'
       OR octet_length(p_metadata::text) > 8192 THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Invalid activity metadata';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.workspace_members wm
        WHERE wm.workspace_id = p_workspace_id
          AND wm.user_id = resolved_actor
          AND wm.removed_at IS NULL
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Activity workspace scope denied';
    END IF;
    IF p_project_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = p_project_id AND p.workspace_id = p_workspace_id
    ) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Activity project scope denied';
    END IF;

    INSERT INTO public.activity_logs (
        workspace_id, project_id, actor_user_id, action, entity_type, entity_id, metadata
    ) VALUES (
        p_workspace_id, p_project_id, resolved_actor, p_action,
        p_entity_type, p_entity_id, p_metadata
    ) RETURNING id INTO new_activity_id;

    RETURN new_activity_id;
END;
$$;

REVOKE ALL ON FUNCTION private.write_activity(uuid, uuid, text, text, uuid, jsonb)
FROM PUBLIC, anon, authenticated;

COMMIT;

-- After review, explicitly set a verified owner and grant EXECUTE only to a
-- writer principal that ordinary request code/users cannot invoke arbitrarily.
-- Do not replace the omitted principal with PUBLIC, anon, authenticated, or a
-- service_role credential merely to make current writes succeed.
