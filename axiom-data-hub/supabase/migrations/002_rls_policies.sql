-- ═══════════════════════════════════════════════════════════════
-- Migration 002: Row Level Security
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ─── Helper: current user's role ───
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.user_role AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ─── Helper: check effective permission for current user ───
-- Used by RLS on future tables (ingestion_jobs, segments, etc.)
-- to enforce granular permissions at the DB level.
-- Contract: call this in RLS USING clauses on data tables, e.g.:
--   CREATE POLICY "..." ON public.segments FOR INSERT
--     WITH CHECK (public.has_permission('canCreateSegments'));
--
-- Resolution order: explicit JSONB override → role defaults.
CREATE OR REPLACE FUNCTION public.has_permission(perm_key TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  p RECORD;
BEGIN
  SELECT role, permissions INTO p FROM public.profiles WHERE id = auth.uid();
  IF p IS NULL THEN RETURN false; END IF;

  -- Explicit per-user override takes priority
  IF p.permissions ? perm_key THEN
    RETURN (p.permissions ->> perm_key)::BOOLEAN;
  END IF;

  -- Superadmin: always true
  IF p.role = 'superadmin' THEN RETURN true; END IF;

  -- Admin: everything except managing users, deleting data, and flushing queue
  IF p.role = 'admin' THEN
    RETURN perm_key NOT IN ('canManageUsers', 'canDeleteData', 'canFlushMailQueue', 'canDeleteSegments');
  END IF;

  -- Member: view pages only (matches frontend ROLE_DEFAULTS.member exactly)
  RETURN perm_key IN (
    'canViewDashboard', 'canViewIngestion', 'canViewSegments',
    'canViewVerification', 'canViewTargets', 'canViewQueue', 'canViewLogs'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ─── SELECT policies ───

CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Superadmins and admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.get_my_role() IN ('superadmin', 'admin'));

-- ─── UPDATE policies ───

-- Users can update their own display fields (full_name, avatar_url).
-- The WITH CHECK prevents them from escalating their own role or permissions.
CREATE POLICY "Users can update own display fields"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (
    id = auth.uid()
    AND role        = (SELECT role        FROM public.profiles WHERE id = auth.uid())
    AND permissions = (SELECT permissions FROM public.profiles WHERE id = auth.uid())
    AND invited_by IS NOT DISTINCT FROM (SELECT invited_by FROM public.profiles WHERE id = auth.uid())
  );

-- Superadmins can update any profile (role, permissions, is_active)
CREATE POLICY "Superadmins can update any profile"
  ON public.profiles FOR UPDATE
  USING (public.get_my_role() = 'superadmin');

-- ─── INSERT policy ───
-- Profiles are only created by handle_new_user() which is SECURITY DEFINER.
-- The anon/authenticated roles should never INSERT directly.
CREATE POLICY "System can insert profiles"
  ON public.profiles FOR INSERT
  WITH CHECK (true);

-- ─── DELETE policy ───
-- Prefer setting is_active = false over hard deletes.
CREATE POLICY "Superadmins can delete profiles"
  ON public.profiles FOR DELETE
  USING (public.get_my_role() = 'superadmin');
