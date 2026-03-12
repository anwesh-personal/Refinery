-- ═══════════════════════════════════════════════════════════════
-- Migration 003: Team Invitations + Invite-Aware Signup
--
-- Defines team_invites table FIRST, then replaces handle_new_user()
-- with the invite-aware version. This solves the forward-reference
-- dependency that existed in the previous version of migration 001.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE public.team_invites (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT NOT NULL,
  role         public.user_role NOT NULL DEFAULT 'member',
  permissions  JSONB NOT NULL DEFAULT '{}',   -- pre-assigned granular overrides
  invited_by   UUID NOT NULL REFERENCES public.profiles(id),
  accepted     BOOLEAN NOT NULL DEFAULT false,
  accepted_at  TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one pending invite per email address
CREATE UNIQUE INDEX idx_invites_pending_email
  ON public.team_invites(email) WHERE accepted = false;

ALTER TABLE public.team_invites ENABLE ROW LEVEL SECURITY;

-- Only superadmins can create invites
CREATE POLICY "Superadmins can create invites"
  ON public.team_invites FOR INSERT
  WITH CHECK (public.get_my_role() = 'superadmin');

-- Superadmins and admins can view all invites
CREATE POLICY "Superadmins and admins can view invites"
  ON public.team_invites FOR SELECT
  USING (public.get_my_role() IN ('superadmin', 'admin'));

-- Superadmins can revoke pending invites
CREATE POLICY "Superadmins can delete invites"
  ON public.team_invites FOR DELETE
  USING (public.get_my_role() = 'superadmin');

-- Superadmins can update invites (resend / change role before acceptance)
CREATE POLICY "Superadmins can update invites"
  ON public.team_invites FOR UPDATE
  USING (public.get_my_role() = 'superadmin');

-- ─── Replace handle_new_user() with invite-aware version ───
-- Now that public.team_invites exists, this is safe.
-- If a pending invite matches the signing-up email, the user gets
-- the invite's role and permission overrides automatically.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  invite_record  RECORD;
  assigned_role  public.user_role := 'member';
  assigned_perms JSONB := '{}';
  inviter_id     UUID := NULL;
  user_count     INT;
  user_active    BOOLEAN := true;
BEGIN
  -- Check for a valid pending invite for this email
  SELECT * INTO invite_record
  FROM public.team_invites
  WHERE email = NEW.email
    AND accepted = false
    AND expires_at > now()
  LIMIT 1;

  IF invite_record IS NOT NULL THEN
    assigned_role  := invite_record.role;
    assigned_perms := COALESCE(invite_record.permissions, '{}');
    inviter_id     := invite_record.invited_by;

    -- Mark the invite as accepted
    UPDATE public.team_invites
    SET accepted = true, accepted_at = now()
    WHERE id = invite_record.id;

  ELSE
    -- No invite found
    SELECT count(*) INTO user_count FROM public.profiles;
    IF user_count = 0 THEN
      -- Very first user ever → auto-promote to superadmin
      assigned_role := 'superadmin';
    ELSE
      -- Not the first user AND no invite → reject by deactivating
      -- They can sign in but is_active=false; the app should check this.
      user_active := false;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, permissions, invited_by, is_active)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    assigned_role,
    assigned_perms,
    inviter_id,
    user_active
  );

  -- Sync role + permissions into user_metadata for cold-start reads
  UPDATE auth.users
  SET raw_user_meta_data =
    raw_user_meta_data
    || jsonb_build_object('role', assigned_role::text)
    || jsonb_build_object('permissions', assigned_perms)
    || jsonb_build_object('is_active', user_active)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Note: no CREATE TRIGGER needed — the trigger on auth.users already
-- points to handle_new_user(). CREATE OR REPLACE updates it in place.
