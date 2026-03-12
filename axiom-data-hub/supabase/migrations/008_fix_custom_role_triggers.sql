-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION 008: Drop broken custom_roles audit triggers
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Context: The triggers created in 005_rbac_v2.sql call auth.uid() to log
-- the actor. auth.uid() returns NULL for service-role connections (i.e. every
-- backend API call using supabaseAdmin). This silently produces audit entries
-- with a NULL actor_id, making the log useless for attribution.
--
-- Fix: Drop these triggers entirely. The backend routes in
-- refinery-backend/src/routes/customRoles.ts now call logAudit() explicitly
-- with the authenticated user's JWT sub as the actorId — producing correct,
-- attributed entries in every case.
-- ═══════════════════════════════════════════════════════════════════════════

DROP TRIGGER IF EXISTS on_custom_role_created ON public.custom_roles;
DROP TRIGGER IF EXISTS on_custom_role_updated ON public.custom_roles;
DROP TRIGGER IF EXISTS on_custom_role_deleted ON public.custom_roles;

DROP FUNCTION IF EXISTS audit_custom_role_insert();
DROP FUNCTION IF EXISTS audit_custom_role_update();
DROP FUNCTION IF EXISTS audit_custom_role_delete();
