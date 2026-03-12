-- ═══════════════════════════════════════════════════════════════
-- Migration 004: Audit Log
--
-- Immutable record of all sensitive actions.
-- No UPDATE or DELETE policies — entries are permanent.
-- actor_id is enforced to be the calling user — forged entries
-- are blocked at the DB level.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE public.audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID NOT NULL REFERENCES public.profiles(id),
  action      TEXT NOT NULL,   -- 'role_change' | 'permission_update' | 'user_deactivated' | 'invite_sent' | 'invite_revoked'
  target_id   UUID,            -- profile ID affected (NULL for non-user actions)
  details     JSONB NOT NULL DEFAULT '{}',  -- { old_role, new_role, changed_permissions, ... }
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_actor   ON public.audit_log(actor_id);
CREATE INDEX idx_audit_target  ON public.audit_log(target_id);
CREATE INDEX idx_audit_action  ON public.audit_log(action);
CREATE INDEX idx_audit_created ON public.audit_log(created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Superadmins and admins can read the audit log
CREATE POLICY "Superadmins and admins can read audit log"
  ON public.audit_log FOR SELECT
  USING (public.get_my_role() IN ('superadmin', 'admin'));

-- Fix #7: actor_id MUST be the current user — prevents forged audit entries
CREATE POLICY "Authenticated users can insert own audit entries"
  ON public.audit_log FOR INSERT
  WITH CHECK (actor_id = auth.uid());

-- No UPDATE policy — audit entries are immutable
-- No DELETE policy  — audit entries are permanent
