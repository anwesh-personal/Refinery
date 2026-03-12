-- ═══════════════════════════════════════════════════════════════
-- Migration 001: Profiles + Granular Permissions
--
-- NOTE: handle_new_user() here is intentionally invite-UNAWARE.
-- The invite-aware version replaces this function in migration 003,
-- AFTER public.team_invites exists. This avoids a forward-reference
-- dependency that would cause "relation does not exist" on signup.
-- ═══════════════════════════════════════════════════════════════

CREATE TYPE public.user_role AS ENUM ('superadmin', 'admin', 'member');

-- Updated_at helper
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── Profiles table ───
CREATE TABLE public.profiles (
  id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT NOT NULL UNIQUE,
  full_name       TEXT NOT NULL DEFAULT '',
  avatar_url      TEXT,
  role            public.user_role NOT NULL DEFAULT 'member',
  is_active       BOOLEAN NOT NULL DEFAULT true,

  -- Granular permissions — each key maps to a UI toggle.
  -- Empty object {} means "use role defaults for everything".
  -- A superadmin edits this JSON per-user from the Team UI.
  permissions     JSONB NOT NULL DEFAULT '{}',

  invited_by      UUID REFERENCES public.profiles(id),
  last_active_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_profiles_email ON public.profiles(email);
CREATE INDEX idx_profiles_role  ON public.profiles(role);

CREATE TRIGGER on_profiles_updated
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- ─── Step 1: Simple signup handler (no invite awareness yet) ───
-- Migration 003 replaces this with the invite-aware version.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  assigned_role  public.user_role := 'member';
  user_count     INT;
BEGIN
  -- First user ever → superadmin
  SELECT count(*) INTO user_count FROM public.profiles;
  IF user_count = 0 THEN
    assigned_role := 'superadmin';
  END IF;

  INSERT INTO public.profiles (id, email, full_name, role, permissions)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', ''),
    assigned_role,
    '{}'
  );

  -- Sync role into user_metadata for cold-start session reads
  UPDATE auth.users
  SET raw_user_meta_data =
    raw_user_meta_data
    || jsonb_build_object('role', assigned_role::text)
    || jsonb_build_object('permissions', '{}'::jsonb)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ─── Sync profile role/permissions back to user_metadata ───
-- Fires when a superadmin updates role or permissions via the Team UI.
-- Keeps metadata fresh so the target user's next session refresh
-- picks up the change without a separate DB fetch.
CREATE OR REPLACE FUNCTION public.sync_profile_to_metadata()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.role IS DISTINCT FROM NEW.role
     OR OLD.permissions IS DISTINCT FROM NEW.permissions THEN
    UPDATE auth.users
    SET raw_user_meta_data =
      raw_user_meta_data
      || jsonb_build_object('role', NEW.role::text)
      || jsonb_build_object('permissions', NEW.permissions)
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_profile_changed
  AFTER UPDATE OF role, permissions ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_to_metadata();
